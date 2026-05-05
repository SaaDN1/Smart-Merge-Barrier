import { useState } from "react";
import { apiJson } from "../api.js";
import "../styles/dashboard.css";

export default function Login({ onAuthenticated }) {
  const [operator, setOperator] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const auth = await apiJson("/api/auth/login", {
        skipAuth: true,
        method: "POST",
        body: JSON.stringify({
          operator,
          password
        })
      });

      onAuthenticated(auth);
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <div className="logo">VTM</div>
          <div>
            <h1 className="sidebar-title">Vehicle Traffic Monitoring</h1>
            <p className="sidebar-sub">Secure operator access</p>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Operator name</span>
            <input
              type="text"
              value={operator}
              onChange={(event) => setOperator(event.target.value)}
              autoComplete="username"
              placeholder="Traffic Operator"
            />
          </label>

          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <div className="auth-error">{error}</div> : null}

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
