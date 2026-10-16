import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useLang } from "@/i18n";
import { colors } from "@/components/theme";

interface DialogReq {
  title: string;
  body?: string;
  confirm?: { okLabel?: string; destructive?: boolean };
}

interface DialogCtx {
  alert: (title: string, body?: string) => Promise<void>;
  confirm: (title: string, body?: string, opts?: { okLabel?: string; destructive?: boolean }) => Promise<boolean>;
}

const Ctx = createContext<DialogCtx | null>(null);

/** In-app alerts/confirms that behave the same on iOS, Android and web (RN's Alert is a no-op on web). */
export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useLang();
  const [current, setCurrent] = useState<DialogReq | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const open = useCallback(
    (req: DialogReq) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setCurrent(req);
      }),
    [],
  );
  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setCurrent(null);
  };

  const value = useMemo<DialogCtx>(
    () => ({
      alert: async (title, body) => {
        await open({ title, body });
      },
      confirm: (title, body, opts) => open({ title, body, confirm: opts ?? {} }),
    }),
    [open],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal transparent visible={current !== null} animationType="fade" onRequestClose={() => close(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card} accessibilityRole="alert">
            <Text style={styles.title}>{current?.title}</Text>
            {current?.body ? <Text style={styles.body}>{current.body}</Text> : null}
            <View style={styles.row}>
              {current?.confirm ? (
                <Pressable style={[styles.btn, styles.secondary]} onPress={() => close(false)} accessibilityRole="button">
                  <Text style={styles.secondaryText}>{t("common.cancel")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.btn, current?.confirm?.destructive ? styles.danger : styles.primary]}
                onPress={() => close(true)}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{current?.confirm?.okLabel ?? t("common.ok")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useDialog(): DialogCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialog outside DialogProvider");
  return v;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 380 },
  title: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 8 },
  body: { fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 },
  btn: { minHeight: 44, minWidth: 88, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  secondary: { backgroundColor: colors.surfaceAlt },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryText: { color: colors.text, fontWeight: "600", fontSize: 15 },
});
