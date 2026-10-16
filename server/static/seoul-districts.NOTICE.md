# Seoul district boundaries

`seoul-districts.geojson` is the simplified 2015 Seoul 시군구 (자치구) boundary file
`juso/2015/json/seoul_municipalities_geo_simple.json` from
[southkorea/seoul-maps](https://github.com/southkorea/seoul-maps) (commit history on the `master` branch).

- **Upstream data:** 서울시 행정구역 시군구, from the 주소기반산업지원서비스 (JUSO), 2015, as published through the Seoul Open Data Plaza.
- **This file's license:** Apache License 2.0, the license of the southkorea/seoul-maps repository, which converted the public boundaries to GeoJSON.
- **Properties used:** `SIG_CD` (자치구 code, matches the app's district codes), `SIG_KOR_NM`, `SIG_ENG_NM`.
- **Geometry:** WGS84 (`EPSG:4326`), 25 polygons, simplified.

The file is served unchanged at `GET /static/geo/seoul-districts.geojson` and drawn by both the Leaflet and Kakao map pages.
