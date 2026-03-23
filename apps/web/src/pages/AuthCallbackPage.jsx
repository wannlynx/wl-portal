import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, completeOAuthLogin } from "../api";

export function AuthCallbackPage({ onAuthenticated }) {
  const navigate = useNavigate();

  useEffect(() => {
    async function finishLogin() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const nextToken = hash.get("token");
      const error = hash.get("error");

      if (error || !nextToken) {
        navigate("/login", {
          replace: true,
          state: { error: error || "oauth_login_failed" }
        });
        return;
      }

      try {
        completeOAuthLogin(nextToken);
        const user = await api.getSessionUser();
        await onAuthenticated(user);
        window.history.replaceState({}, document.title, "/");
        navigate("/", { replace: true });
      } catch (_err) {
        navigate("/login", {
          replace: true,
          state: { error: "oauth_session_invalid" }
        });
      }
    }

    finishLogin();
  }, [navigate, onAuthenticated]);

  return <div className="login-status">Completing sign-in...</div>;
}
