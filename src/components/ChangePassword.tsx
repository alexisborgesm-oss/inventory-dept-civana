import React, { useState } from "react";
import { supabase } from "../utils/supabase";

const passwordPolicy = (pwd: string) => {
  // Ejemplo: mínimo 8, mayúscula, minúscula, número, símbolo
  const okLength = pwd.length >= 8;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSymbol = /[^A-Za-z0-9]/.test(pwd);
  return okLength && hasUpper && hasLower && hasDigit && hasSymbol;
};

const ChangePassword: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!currentPassword || !newPassword || !confirmNew) {
      setMsg({ type: "err", text: "Completa todos los campos." });
      return;
    }
    if (newPassword !== confirmNew) {
      setMsg({ type: "err", text: "La nueva contraseña y su confirmación no coinciden." });
      return;
    }
    if (!passwordPolicy(newPassword)) {
      setMsg({
        type: "err",
        text:
          "La contraseña debe tener al menos 8 caracteres, mayúscula, minúscula, número y símbolo.",
      });
      return;
    }

    setLoading(true);
    try {
      // 1) obtener el email del usuario autenticado
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user?.email) {
        throw new Error("No se pudo obtener el usuario autenticado.");
      }
      const email = userData.user.email;

      // 2) verificar contraseña actual (reauth “manual”)
      const { error: signinErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signinErr) {
        // error típico: { message: "Invalid login credentials" }
        throw new Error("La contraseña actual no es correcta.");
      }

      // 3) actualizar contraseña
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) {
        throw updErr;
      }

      setMsg({ type: "ok", text: "¡Contraseña actualizada correctamente!" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNew("");
    } catch (err: any) {
      setMsg({ type: "err", text: err?.message || "Error al cambiar la contraseña." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <h3 style={styles.title}>Cambiar contraseña</h3>

      <label style={styles.label}>Contraseña actual</label>
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        style={styles.input}
        autoComplete="current-password"
      />

      <label style={styles.label}>Nueva contraseña</label>
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        style={styles.input}
        autoComplete="new-password"
        placeholder="Mín. 8 + mayúsculas + minúsculas + número + símbolo"
      />

      <label style={styles.label}>Confirmar nueva contraseña</label>
      <input
        type="password"
        value={confirmNew}
        onChange={(e) => setConfirmNew(e.target.value)}
        style={styles.input}
        autoComplete="new-password"
      />

      <button type="submit" disabled={loading} style={styles.button}>
        {loading ? "Guardando..." : "Guardar cambios"}
      </button>

      {msg && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: msg.type === "ok" ? "#e8f5e9" : "#fdecea",
            color: msg.type === "ok" ? "#1b5e20" : "#c62828",
            border: `1px solid ${msg.type === "ok" ? "#c8e6c9" : "#f5c6cb"}`,
          }}
        >
          {msg.text}
        </div>
      )}
    </form>
  );
};

const styles: Record<string, React.CSSProperties> = {
  form: {
    maxWidth: 420,
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
  },
  title: { margin: "0 0 12px", fontSize: 18, fontWeight: 600 },
  label: { display: "block", fontSize: 13, color: "#374151", marginTop: 10, marginBottom: 6 },
  input: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 14,
    outline: "none",
  },
  button: {
    marginTop: 14,
    padding: "10px 16px",
    borderRadius: 8,
    background: "#16a34a",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
  },
};

export default ChangePassword;
