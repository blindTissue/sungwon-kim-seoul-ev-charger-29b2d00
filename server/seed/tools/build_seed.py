#!/usr/bin/env python3
"""
Builds server/seed/stations.json and server/seed/districts.json.

Inputs (OpenStreetMap snapshots, not committed; see README "Seed data"):
  RAW_DIR/parking.json        Overpass: named amenity=parking in Seoul
  RAW_DIR/pois.json           Overpass: townhalls, marts, department stores in Seoul
  RAW_DIR/districts_poly.json Nominatim: polygons of the 25 자치구
Reverse-geocoding results are cached in RAW_DIR/geocache.json (Nominatim, 1 req/s).

Locations are real public sites taken from OSM; charger configuration is synthetic
and generated deterministically from SEED.

Usage: RAW_DIR=/tmp/osm python3 build_seed.py
"""
import json
import math
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

RAW = os.environ.get("RAW_DIR", "/tmp/osm")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SEED = 20261016
PER_DISTRICT = 8
MIN_SPACING_M = 350
UA = "seoul-ev-mvp/0.1 (seed builder)"

# ---------------------------------------------------------------- romanization
CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]
# final consonant carried to the next syllable when followed by ㅇ
JONG_LIAISON = {1: "g", 2: "kk", 4: "n", 7: "d", 8: "r", 16: "m", 17: "b", 19: "s", 20: "ss", 22: "j", 23: "ch", 25: "t", 26: "p"}


def romanize(text):
    out = []
    chars = list(text)
    carry = None
    for i, c in enumerate(chars):
        code = ord(c) - 0xAC00
        if 0 <= code < 11172:
            cho, jung, jong = code // 588, (code % 588) // 28, code % 28
            nxt = ord(chars[i + 1]) - 0xAC00 if i + 1 < len(chars) else -1
            nxt_cho = nxt // 588 if 0 <= nxt < 11172 else None
            init = CHO[cho]
            if carry is not None:
                init = carry
                carry = None
            elif cho == 5 and out and out[-1].endswith(("l", "n")):
                init = "l"
            elif cho == 2 and out and out[-1].endswith("l"):
                init = "l"
            elif cho == 5 and out and out[-1].endswith(("ng", "m")):
                init = "n"
            syl = init + JUNG[jung]
            if jong:
                if nxt_cho == 11 and jong in JONG_LIAISON:
                    carry = JONG_LIAISON[jong]
                elif nxt_cho == 5 and jong in (4, 8):
                    syl += "l"
                elif nxt_cho in (2, 6, 5) and JONG[jong] in ("k", "t", "p"):
                    syl += {"k": "ng", "t": "n", "p": "m"}[JONG[jong]]
                else:
                    syl += JONG[jong]
            out.append(syl)
        else:
            out.append(c)
    s = "".join(out)
    return s[:1].upper() + s[1:]


def has_hangul(s):
    return bool(re.search("[가-힣]", s or ""))


def dong_en(dong):
    m = re.match(r"^(.+?)(\d*)(동|가)$", dong)
    if not m:
        return romanize(dong)
    base, num, suf = m.groups()
    return f"{romanize(base)}{' ' + num if num else ''}-{'dong' if suf == '동' else 'ga'}"


# ---------------------------------------------------------------- geometry
def haversine(a, b):
    R = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_geojson(lat, lng, g):
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        if in_ring(lng, lat, poly[0]) and not any(in_ring(lng, lat, h) for h in poly[1:]):
            return True
    return False


# ---------------------------------------------------------------- candidates
RETAIL_RE = re.compile(r"(?<!케)이마트|E-?Mart|Emart|홈플러스|Homeplus|롯데마트|Lotte Mart|코스트코|Costco|백화점|Department|신세계|현대시티|아이파크", re.I)
RETAIL_EXCLUDE = re.compile(r"익스프레스|Express|Exprees|에브리데이|everyday|이마트24|슈퍼마켓|Duty|면세|Muji|Friends|Body|Folder|다이소|Himart|underground|영플라자|에비뉴엘|두타", re.I)


def brand_of(t):
    s = t.get("name", "") + " " + t.get("brand", "") + " " + t.get("name:en", "")
    table = [
        (r"코스트코|Costco", "코스트코", "Costco"),
        (r"롯데마트|Lotte Mart", "롯데마트", "Lotte Mart"),
        (r"홈플러스|Homeplus", "홈플러스", "Homeplus"),
        (r"(?<!케)이마트|E-?Mart|Emart", "이마트", "E-Mart"),
        (r"롯데백화점|Lotte Department", "롯데백화점", "Lotte Department Store"),
        (r"현대시티", "현대시티아울렛", "Hyundai City Outlet"),
        (r"신세계", "신세계백화점", "Shinsegae Department Store"),
        (r"아이파크", "아이파크몰", "I'Park Mall"),
        (r"NC", "NC백화점", "NC Department Store"),
    ]
    for pat, ko, en in table:
        if re.search(pat, s, re.I):
            return ko, en
    return None


def classify(e):
    t = e["tags"]
    n = t.get("name", "")
    if t.get("amenity") == "parking":
        if re.search("아파트|빌라|민영|지하주차장$|타워|버스|그린카|안내|차고지|Parking|parking", n) or not has_hangul(n):
            return None
        if "환승" in n:
            return "transfer_parking"
        if "공원" in n:
            return "park"
        if "구청" in n:
            return "gov_office"
        if re.search("공영|구립|공용|공공", n):
            return "public_parking"
        return None
    if t.get("amenity") == "townhall":
        if re.search(r"구청( ?(본관|청사))?$", n) and not re.search("별관|분관|보건", n):
            return "gov_office"
        if re.search("주민센터|행정복지센터", n):
            return "community_center"
        return None
    if t.get("shop") in ("supermarket", "department_store", "wholesale"):
        text = n + " " + t.get("brand", "") + " " + t.get("name:en", "")
        if RETAIL_RE.search(text) and not RETAIL_EXCLUDE.search(n + " " + t.get("name:en", "")) and brand_of(t):
            return "retail"
    return None


def pos(e):
    if "lat" in e:
        return e["lat"], e["lon"]
    return e["center"]["lat"], e["center"]["lon"]


PRIORITY = {"gov_office": 0, "transfer_parking": 1, "retail": 2, "park": 3, "public_parking": 4, "community_center": 5}
QUOTA = {"gov_office": 1, "transfer_parking": 1, "retail": 2, "park": 1, "public_parking": 3, "community_center": 8}


def select(districts):
    elems = json.load(open(os.path.join(RAW, "parking.json")))["elements"] + json.load(open(os.path.join(RAW, "pois.json")))["elements"]
    by_d = {d["code"]: [] for d in districts}
    for e in elems:
        st = classify(e)
        if not st:
            continue
        lat, lng = pos(e)
        for d in districts:
            if in_geojson(lat, lng, d["geojson"]):
                by_d[d["code"]].append({"osm": f"{e['type']}/{e['id']}", "site_type": st, "lat": round(lat, 6), "lng": round(lng, 6), "tags": e["tags"]})
                break
    rng = random.Random(SEED)
    chosen = []
    for d in districts:
        cands = by_d[d["code"]]
        rng.shuffle(cands)
        cands.sort(key=lambda c: PRIORITY[c["site_type"]])
        picked, counts = [], {}
        for pass_no in (0, 1):
            for c in cands:
                if len(picked) >= PER_DISTRICT:
                    break
                if c in picked:
                    continue
                if pass_no == 0 and counts.get(c["site_type"], 0) >= QUOTA[c["site_type"]]:
                    continue
                if any(haversine((c["lat"], c["lng"]), (p["lat"], p["lng"])) < MIN_SPACING_M for p in picked):
                    continue
                if any(c["tags"].get("name") == p["tags"].get("name") and c["site_type"] != "retail" for p in picked):
                    continue
                picked.append(c)
                counts[c["site_type"]] = counts.get(c["site_type"], 0) + 1
        print(d["name_ko"], len(cands), "->", len(picked), counts, file=sys.stderr)
        for p in picked:
            p["district_code"] = d["code"]
        chosen += picked
    return chosen


# ---------------------------------------------------------------- geocoding
def reverse(lat, lng, lang, cache):
    key = f"{lat},{lng},{lang}"
    if key in cache:
        return cache[key]
    q = urllib.parse.urlencode({"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 18, "addressdetails": 1, "accept-language": lang})
    req = urllib.request.Request("https://nominatim.openstreetmap.org/reverse?" + q, headers={"User-Agent": UA})
    r = {}
    for attempt in range(4):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            break
        except Exception as ex:  # noqa: BLE001
            print("retry", key, ex, file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    cache[key] = r.get("address", {})
    time.sleep(1.05)
    return cache[key]


def dong_of(addr):
    for k in ("quarter", "suburb", "neighbourhood", "city_district"):
        v = addr.get(k, "")
        if re.search(r"(동|가)$", v) and not v.endswith("구"):
            return v
    return ""


def dong_en_of(addr_en, dong_ko):
    for k in ("quarter", "suburb", "neighbourhood"):
        v = addr_en.get(k, "")
        if v and not has_hangul(v) and re.search(r"dong|ga", v, re.I):
            return v
    return dong_en(dong_ko) if dong_ko else ""


def road_en_of(road):
    for suf, en in (("대로", "-daero"), ("로", "-ro"), ("길", "-gil")):
        if road.endswith(suf):
            base = road[: -len(suf)]
            m = re.match(r"^(.*?)(\d+)(.*)$", base)
            if m and suf == "길":
                head = m.group(1)
                kind = "-daero" if head.endswith("대로") else "-ro" if head.endswith("로") else "-gil"
                head = re.sub(r"(대로|로|길)$", "", head)
                return f"{romanize(head)}{kind} {m.group(2)}{romanize(m.group(3)).lower()}-gil"
            return romanize(base) + en
    return romanize(road)


def addresses(addr_ko, addr_en, d):
    road = addr_ko.get("road", "")
    hn = addr_ko.get("house_number", "")
    dong = dong_of(addr_ko)
    if road:
        ko = f"서울특별시 {d['name_ko']} {road}{' ' + hn if hn else ''}"
    else:
        ko = f"서울특별시 {d['name_ko']} {dong}".strip()
    road_en = addr_en.get("road", "")
    if road and (not road_en or has_hangul(road_en)):
        road_en = road_en_of(road)
    if road_en:
        en = f"{hn + ' ' if hn else ''}{road_en}, {d['name_en']}, Seoul"
    else:
        dn = dong_en_of(addr_en, dong)
        en = f"{dn + ', ' if dn else ''}{d['name_en']}, Seoul"
    return ko, en, dong


# ---------------------------------------------------------------- naming
WORDS = [
    ("광역환승센터", " Transit Center"),
    ("환승센터", " Transfer Center"),
    ("빗물펌프장", " Rainwater Pump Station"),
    ("스포츠센터", " Sports Center"),
    ("체육공원", " Sports Park"),
    ("빌딩앞", " Building"),
    ("환승주차장", "Park-and-Ride Lot"),
    ("환승", "Park-and-Ride"),
    ("공영주차장", "Public Parking Lot"),
    ("공영 주차장", "Public Parking Lot"),
    ("공용주차장", "Public Parking Lot"),
    ("공동주차장", "Public Parking Lot"),
    ("공공주차장", "Public Parking Lot"),
    ("유료주차장", "Paid Parking Lot"),
    ("노외주차장", "Off-street Parking Lot"),
    ("주차장", "Parking Lot"),
    ("구립", "District-run"),
    ("공원", " Park"),
    ("청사", " Office"),
]


def translate_name(ko):
    name = ko
    num = None
    m = re.match(r"^(.*?)\s*제\s*(\d+)\s*(.*)$", name)
    if m:
        name, num = (m.group(1) + " " + m.group(3)).strip(), m.group(2)
    parts = []
    rest = name
    while rest:
        rest = rest.strip()
        hit = False
        for w, en in WORDS:
            if rest.startswith(w):
                parts.append(en)
                rest = rest[len(w):]
                hit = True
                break
        if hit:
            continue
        nxt = min([i for i in (rest.find(w) for w, _ in WORDS) if i > 0] or [len(rest)])
        chunk = rest[:nxt].strip()
        rest = rest[nxt:]
        if not chunk:
            continue
        if " " in chunk:
            head, tail = chunk.split(" ", 1)
            chunk, rest = head, tail + rest
        if re.match(r"^(.+?)(\d+)?(동|가)$", chunk) and len(chunk) <= 6:
            parts.append(dong_en(chunk))
        elif chunk.endswith("구청"):
            parts.append(romanize(chunk[:-2]) + "-gu Office")
        elif chunk.endswith("역"):
            parts.append(romanize(chunk[:-1]) + " Station")
        else:
            parts.append(romanize(chunk))
    out = ""
    for p in parts:
        out += p if p.startswith(" ") else (" " if out else "") + p
    out = re.sub(r"\s+", " ", out).strip()
    if num:
        out += f" No. {num}"
    return out


def clean_ko(n):
    return re.sub(r"\s*\([^)]*\)\s*", " ", n).strip()


def english_from_tags(t):
    en = t.get("name:en", "")
    if not en:
        m = re.search(r"\(([A-Za-z][^)]*)\)", t.get("name", ""))
        en = m.group(1) if m else ""
    return en.strip()


def names_for(c, d, dong_ko):
    t = c["tags"]
    st = c["site_type"]
    if st == "retail":
        bko, ben = brand_of(t)
        branch_ko = re.sub(r"\d*(동|가)$", "", dong_ko) if dong_ko else ""
        branch_ko = re.sub(r"\d+가$", "", branch_ko) or d["name_ko"][:-1]
        if len(branch_ko) == 1:
            branch_ko += "동"
        return f"{bko} {branch_ko}점 주차장", f"{ben} {romanize(branch_ko)} Parking"
    ko = clean_ko(t["name"])
    if st == "gov_office":
        if "구청" not in ko:
            ko = f"{d['name_ko']}청"
        ko = re.sub(r"\s*(유료)?주차장$", "", ko) + " 주차장"
        return ko, f"{d['name_en']} Office Parking"
    if st == "community_center":
        base = re.sub(r"\s*(주민센터|주민센|행정복지센터)$", "", ko).strip()
        en_base = dong_en(base) if re.search("(동|가)$", base) else romanize(base)
        return f"{base} 주민센터 주차장", f"{en_base} Community Service Center Parking"
    if ko.endswith("공영"):
        ko += "주차장"
    if re.match(r"^(공영|공용)\s*주차장", ko):
        prefix = re.sub(r"\d*(동|가)$", "", dong_ko) or d["name_ko"][:-1]
        prefix += "동" if len(prefix) == 1 else ""
        ko = prefix + " " + re.sub(r"^(공영|공용)\s*주차장\s*", "공영주차장 ", ko).strip()
    en = english_from_tags(t)
    generic = re.fullmatch(r"(public |paid )?parking( lot)?", en.strip(), re.I)
    if not en or has_hangul(en) or generic or not re.search("park", en, re.I):
        en = translate_name(ko)
    return ko, en


# ---------------------------------------------------------------- chargers & meta
FEE = {
    "public_parking": ("충전 중 1시간 무료, 이후 5분당 150원", "Free for 1 h while charging, then KRW 150 per 5 min"),
    "transfer_parking": ("대중교통 환승 시 할인, 충전 차량 2시간 무료", "Transit transfer discount; free for 2 h while charging"),
    "park": ("충전 중 1시간 무료, 이후 10분당 300원", "Free for 1 h while charging, then KRW 300 per 10 min"),
    "gov_office": ("민원 방문 및 충전 차량 1시간 무료", "Free for 1 h for visitors and charging vehicles"),
    "community_center": ("충전 중 30분 무료, 이후 10분당 300원", "Free for 30 min while charging, then KRW 300 per 10 min"),
    "retail": ("구매 금액에 따라 최대 3시간 무료", "Up to 3 h free depending on purchase amount"),
}
HOURS = {
    "public_parking": "00:00-24:00",
    "transfer_parking": "00:00-24:00",
    "park": "05:00-23:00",
    "gov_office": "00:00-24:00",
    "community_center": "06:00-22:00",
    "retail": "10:00-23:00",
}
NOTES = [
    ("지상 주차장 입구 오른쪽", "Right side of the surface lot entrance"),
    ("지하 1층 엘리베이터 옆", "B1, next to the elevator"),
    ("지하 2층 B구역", "B2, zone B"),
    ("정문 진입 후 왼쪽 끝", "Far left after the main entrance"),
    ("지상 1층 충전 전용 구역", "Ground floor, EV-only bays"),
    ("지하 1층 C구역 기둥 C-12 부근", "B1 zone C, near pillar C-12"),
]
COUNT_RANGE = {"public_parking": (2, 6), "transfer_parking": (4, 8), "park": (2, 5), "gov_office": (3, 6), "community_center": (2, 4), "retail": (4, 8)}
DC_P = {"public_parking": 0.3, "transfer_parking": 0.4, "park": 0.25, "gov_office": 0.3, "community_center": 0.2, "retail": 0.38}


def make_chargers(rng, sid, st):
    lo, hi = COUNT_RANGE[st]
    n = rng.randint(lo, hi)
    out = []
    for _ in range(n):
        if rng.random() < DC_P[st]:
            connector = "DC_COMBO" if rng.random() < 0.78 else "CHADEMO"
            power = rng.choices([50, 100, 200], [0.5, 0.35, 0.15])[0]
            out.append({"speed": "DC", "connector": connector, "power_kw": power, "price_per_kwh_krw": 324.4 if power <= 50 else 347.2})
        elif rng.random() < 0.1:
            out.append({"speed": "AC", "connector": "AC3", "power_kw": 22, "price_per_kwh_krw": 295.0})
        else:
            out.append({"speed": "AC", "connector": "AC_TYPE1", "power_kw": 7, "price_per_kwh_krw": 255.7})
    out.sort(key=lambda c: (c["speed"] != "DC", -c["power_kw"]))
    return [{"id": f"{sid}-C{i + 1}", **c} for i, c in enumerate(out)]


def main():
    districts = json.load(open(os.path.join(RAW, "districts_poly.json")))
    chosen = select(districts)
    cache_path = os.path.join(RAW, "geocache.json")
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    dmap = {d["code"]: d for d in districts}
    rng = random.Random(SEED)
    stations = []
    for idx, c in enumerate(chosen):
        d = dmap[c["district_code"]]
        a_ko = reverse(c["lat"], c["lng"], "ko", cache)
        a_en = reverse(c["lat"], c["lng"], "en", cache)
        if idx % 20 == 0:
            json.dump(cache, open(cache_path, "w"), ensure_ascii=False)
            print("geocoded", idx, file=sys.stderr)
        addr_ko, addr_en, dong = addresses(a_ko, a_en, d)
        name_ko, name_en = names_for(c, d, dong)
        if any(x["name_ko"] == name_ko for x in stations):
            name_ko = re.sub(r"주차장$", "제2주차장", name_ko)
            name_en += " 2"
        n_in_d = len([s for s in stations if s["district_code"] == c["district_code"]]) + 1
        sid = f"ST{c['district_code']}-{n_in_d:02d}"
        note = rng.choice(NOTES)
        st = c["site_type"]
        stations.append({
            "id": sid,
            "name_ko": name_ko,
            "name_en": name_en,
            "address_ko": addr_ko,
            "address_en": addr_en,
            "district_code": c["district_code"],
            "lat": c["lat"],
            "lng": c["lng"],
            "lot_type": "semi_public" if st == "retail" else "public",
            "site_type": st,
            "operator_note_ko": note[0],
            "operator_note_en": note[1],
            "open_hours": HOURS[st],
            "parking_fee_note_ko": FEE[st][0],
            "parking_fee_note_en": FEE[st][1],
            "source": f"OpenStreetMap {c['osm']}",
            "chargers": make_chargers(rng, sid, st),
        })
    json.dump(cache, open(cache_path, "w"), ensure_ascii=False)
    meta = {
        "version": 1,
        "generated_by": "server/seed/tools/build_seed.py",
        "note": "Locations derived from OpenStreetMap (ODbL). Charger configuration is synthetic. Availability is simulated.",
    }
    with open(os.path.join(OUT_DIR, "stations.json"), "w") as f:
        json.dump({**meta, "stations": stations}, f, ensure_ascii=False, indent=1)

    def bbox(g):
        pts = []
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for p in polys:
            pts += p[0]
        lngs, lats = [p[0] for p in pts], [p[1] for p in pts]
        return {"south": round(min(lats), 5), "west": round(min(lngs), 5), "north": round(max(lats), 5), "east": round(max(lngs), 5)}

    dout = [{"code": d["code"], "name_ko": d["name_ko"], "name_en": d["name_en"],
             "center": {"lat": round(d["center"][0], 5), "lng": round(d["center"][1], 5)}, "bbox": bbox(d["geojson"])} for d in districts]
    with open(os.path.join(OUT_DIR, "districts.json"), "w") as f:
        json.dump({"version": 1, "districts": dout}, f, ensure_ascii=False, indent=1)
    total = sum(len(s["chargers"]) for s in stations)
    dc = sum(1 for s in stations for c in s["chargers"] if c["speed"] == "DC")
    print(f"stations={len(stations)} chargers={total} dc_ratio={dc / total:.2f}", file=sys.stderr)


if __name__ == "__main__":
    main()
