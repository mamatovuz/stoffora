import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Copy, Eye, EyeOff } from "lucide-react";
import { ApiError, api, errorText, post } from "../../api";
import { checkLoginInput, LOGIN_SUFFIX, passwordProblem, suggestLoginLocal } from "@/lib/staff-login";
import { Sheet, type Toast } from "./shared";
import { haptic } from "./tg";

/*
 * «Ilovaga kirish»: Staffora telefon ilovasiga login (<nom>@staffora.uz) va parol bilan kiriladi.
 * Login bir marta tanlanadi va o‘zgarmaydi; parolni shu yerda istalgan vaqtda yangilash mumkin —
 * Telegram orqali kirgan xodimdan eski parol so‘ralmaydi (bu «parolni unutdim» ham).
 * Eski bir martalik kod bilan ulash o‘rniga.
 */

type Account = { login: string | null; suggested?: string; hasPassword?: boolean };
type Mode = "create" | "password";

/** «ozodbek@staffora.uz» → «ozodbek» (maydonda domen alohida, o‘zgarmas yozuv). */
const localOf = (login?: string) => {
  const value = (login || "").trim();
  return value.toLowerCase().endsWith(LOGIN_SUFFIX) ? value.slice(0, -LOGIN_SUFFIX.length) : value;
};

export function AppLoginGroup({ onToast, initialLogin, firstName, lastName }: { onToast: Toast; initialLogin?: string; firstName: string; lastName: string }) {
  const [account, setAccount] = useState<Account | null>(initialLogin ? { login: initialLogin } : null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [sheet, setSheet] = useState<Mode | null>(null);
  const load = useCallback(() => {
    setState("loading");
    api<Account>("/mini/account")
      .then((value) => {
        setAccount(value);
        setState("ready");
      })
      // Server hali yangilanmagan (404) — bo‘lim ko‘rinmaydi; boshqa xatoda «qayta urinish».
      .catch((reason) => setState(reason instanceof ApiError && reason.status === 404 ? "missing" : "error"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const login = account?.login || null;
  if (state === "missing" && !login) return null;

  const copy = async () => {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(login);
      haptic.success();
      onToast("Login nusxalandi");
    } catch {
      onToast("Nusxalab bo‘lmadi — loginni qo‘lda yozing", "error");
    }
  };

  return (
    <>
      <div className="mp-group-title">Ilovaga kirish</div>
      <section className="mp-group">
        {login ? (
          <>
            <button className="mp-row link al-row" onClick={() => void copy()} aria-label="Loginni nusxalash">
              <span>Login</span>
              <b>
                <span className="al-value">{login}</span>
                <Copy size={15} />
              </b>
            </button>
            <button className="mp-row link" onClick={() => setSheet("password")}>
              <span>Parolni o‘zgartirish</span>
              <ChevronRight size={16} />
            </button>
          </>
        ) : state === "error" ? (
          <button className="mp-row link" onClick={load}>
            <span>Ma’lumot yuklanmadi</span>
            <b>Qayta urinish</b>
          </button>
        ) : (
          <button className="mp-row link" onClick={() => setSheet("create")} disabled={state === "loading"}>
            <span>Login va parol yaratish</span>
            <ChevronRight size={16} />
          </button>
        )}
      </section>
      {login && <p className="mp-note al-hint">Staffora ilovasida shu login va parol bilan kirasiz</p>}
      {sheet && (
        <AccountSheet
          mode={sheet}
          login={login}
          suggested={localOf(account?.suggested) || suggestLoginLocal(firstName, lastName)}
          onClose={() => setSheet(null)}
          onFixed={() => {
            setSheet(null);
            onToast("Login allaqachon yaratilgan");
            load();
          }}
          onSaved={(saved) => {
            setSheet(null);
            setAccount((current) => ({ ...(current || {}), login: saved, hasPassword: true }));
            haptic.success();
            onToast(sheet === "create" ? "Login va parol saqlandi" : "Parol yangilandi");
          }}
        />
      )}
    </>
  );
}

function AccountSheet({
  mode,
  login,
  suggested,
  onClose,
  onSaved,
  onFixed,
}: {
  mode: Mode;
  login: string | null;
  suggested: string;
  onClose: () => void;
  onSaved: (login: string) => void;
  onFixed: () => void;
}) {
  const creating = mode === "create";
  const [local, setLocal] = useState(creating ? suggested : "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState({ password: false, repeat: false });
  const [serverErr, setServerErr] = useState<{ login?: string; password?: string; general?: string }>({});
  const [busy, setBusy] = useState(false);

  const loginCheck = creating ? checkLoginInput(local) : null;
  const loginErr = serverErr.login || (loginCheck && !loginCheck.ok && local.trim() ? loginCheck.error : "");
  const pwProblem = passwordProblem(password);
  const pwErr = serverErr.password || (touched.password && password ? pwProblem || "" : "");
  const repeatErr = (touched.repeat || repeat.length >= password.length) && repeat && repeat !== password ? "Parollar mos emas" : "";
  const valid = (!creating || Boolean(loginCheck?.ok)) && !pwProblem && repeat === password && !busy;

  async function save() {
    setTouched({ password: true, repeat: true });
    if (!valid) return;
    setBusy(true);
    setServerErr({});
    try {
      const body = creating && loginCheck?.ok ? { login: loginCheck.local, password } : { password };
      const result = await post<{ ok: boolean; login: string }>("/mini/account", body);
      onSaved(result.login || (loginCheck?.ok ? loginCheck.login : login) || "");
    } catch (reason) {
      haptic.error();
      const code = reason instanceof ApiError ? reason.code : undefined;
      const message = errorText(reason);
      if (code === "LOGIN_TAKEN") setServerErr({ login: "Bu login band — boshqasini yozing" });
      else if (code === "LOGIN_INVALID") setServerErr({ login: message || "Login noto‘g‘ri" });
      else if (code === "PASSWORD_WEAK") setServerErr({ password: message || "Parol juda oddiy" });
      else if (code === "LOGIN_FIXED") return onFixed();
      else if (reason instanceof ApiError && reason.status === 404) setServerErr({ general: "Bu imkoniyat hali yoqilmagan. Birozdan keyin urinib ko‘ring." });
      else setServerErr({ general: message || "Saqlanmadi" });
    } finally {
      setBusy(false);
    }
  }

  const eye = (
    <button type="button" className="al-eye" onClick={() => setShow(!show)} aria-label={show ? "Parolni yashirish" : "Parolni ko‘rsatish"}>
      {show ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
  return (
    <Sheet
      title={creating ? "Ilovaga kirish" : "Parolni o‘zgartirish"}
      subtitle={creating ? undefined : login || undefined}
      onClose={onClose}
      primary={{ text: "Saqlash", onClick: () => void save(), busy, disabled: !valid }}
    >
      <form
        className="al-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {creating && (
          <label>
            Login
            <span className={`al-input ${loginErr ? "bad" : ""}`}>
              <input
                value={local}
                onChange={(e) => {
                  setLocal(e.target.value);
                  if (serverErr.login) setServerErr({ ...serverErr, login: undefined });
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                maxLength={60}
                aria-invalid={Boolean(loginErr)}
              />
              <span className="al-suffix">{LOGIN_SUFFIX}</span>
            </span>
            {loginErr && <small className="al-err">{loginErr}</small>}
          </label>
        )}
        <label>
          {creating ? "Parol" : "Yangi parol"}
          <span className={`al-input ${pwErr ? "bad" : ""}`}>
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (serverErr.password) setServerErr({ ...serverErr, password: undefined });
              }}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              autoComplete="new-password"
              maxLength={72}
              aria-invalid={Boolean(pwErr)}
            />
            {eye}
          </span>
          {pwErr ? <small className="al-err">{pwErr}</small> : <small className="al-help">Kamida 8 belgi: harf va raqam</small>}
        </label>
        <label>
          Parolni takrorlang
          <span className={`al-input ${repeatErr ? "bad" : ""}`}>
            <input
              type={show ? "text" : "password"}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, repeat: true }))}
              autoComplete="new-password"
              maxLength={72}
              aria-invalid={Boolean(repeatErr)}
            />
          </span>
          {repeatErr && <small className="al-err">{repeatErr}</small>}
        </label>
        {serverErr.general && <small className="al-err">{serverErr.general}</small>}
        {/* Enter bilan yuborish (Telegram tashqarisida — Sheet o‘z tugmasini ko‘rsatadi). */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
