import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getOAuthProviders, loginDefault, loginWithPassword, oauthStartUrl } from "../api";

const wannLynxLogoUrl = "https://wannlynx.com/wannlynx_logo-removebg-preview.png";

export function LoginPage({ onAuthenticated }) {
  const location = useLocation();
  const [email, setEmail] = useState("manager@demo.com");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState(location.state?.error || "");
  const [busy, setBusy] = useState("");
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    getOAuthProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  async function handlePasswordLogin(event) {
    event.preventDefault();
    setBusy("password");
    setError("");
    try {
      const data = await loginWithPassword(email, password);
      await onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function handleDemoLogin() {
    setBusy("demo");
    setError("");
    try {
      const data = await loginDefault();
      await onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function handleOauthLogin(provider) {
    window.location.href = oauthStartUrl(provider);
  }

  const googleProvider = providers.find((provider) => provider.key === "google");

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="login-copy">
          <span className="login-kicker">Local Development Mode</span>
          <img src={wannLynxLogoUrl} alt="WannLynx logo" className="login-brand-logo" />
          <h1>Petroleum Command Center</h1>
          <p>
            Keep development on your PC. Use the demo login for daily local work, or test OAuth locally when your
            Google callback is configured for `localhost`.
          </p>
          <div className="login-badges">
            <span>Local API</span>
            <span>Local Postgres</span>
            <span>Render deploy later</span>
          </div>
        </div>
        <div className="login-panel">
          <div className="login-panel-head">
            <strong>Sign in</strong>
            <span>Demo credentials are prefilled for local validation.</span>
          </div>
          <form className="login-form" onSubmit={handlePasswordLogin}>
            <label>
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="login-primary" disabled={!!busy}>
              {busy === "password" ? "Signing in..." : "Sign in with password"}
            </button>
          </form>
          <button type="button" className="login-secondary" onClick={handleDemoLogin} disabled={!!busy}>
            {busy === "demo" ? "Connecting..." : "Use demo manager login"}
          </button>
          <button
            type="button"
            className="login-oauth"
            onClick={() => handleOauthLogin("google")}
            disabled={!!busy || !googleProvider?.enabled}
          >
            {googleProvider?.enabled ? "Sign in with Google" : "Google OAuth not configured locally"}
          </button>
          {error ? <div className="login-error">{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
