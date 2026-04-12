import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, getToken, logout } from "./api";
import { PortfolioPage } from "./pages/PortfolioPage";
import { WorkQueuePage } from "./pages/WorkQueuePage";
import { TankInformationPage } from "./pages/TankInformationPage";
import { TankChartsPage } from "./pages/TankChartsPage";
import { AlliedPage } from "./pages/AlliedPage";
import { AlliedMgmtPage } from "./pages/AlliedMgmtPage";
import { SiteDetailPage } from "./pages/SiteDetailPage";
import { LayoutPage } from "./pages/LayoutPage";
import { LayoutEditorPage } from "./pages/LayoutEditorPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { ManagementPage } from "./pages/ManagementPage";
import { PriceTablesPage } from "./pages/PriceTablesPage";
import { MobilePricesPage } from "./pages/MobilePricesPage";
import xpLogo from "./assets/xprotean-logo.svg";

const PricingPage = lazy(() =>
  import("./pricing/pages/PricingPage").then((module) => ({ default: module.PricingPage }))
);

function AppFrame({ children, user, jobber, onLogout }) {
  const location = useLocation();
  const pageTitle =
    location.pathname.startsWith("/sites/") ? "Site Operations" :
    location.pathname.startsWith("/management") ? "Users" :
    location.pathname.startsWith("/mobile-prices") ? "Mobile Prices" :
    location.pathname.startsWith("/price-tables") ? "Price Tables" :
    location.pathname.startsWith("/pricing") ? "Pricing" :
    location.pathname.startsWith("/allied-mgmt") ? "Allied Management" :
    location.pathname.startsWith("/allied") ? "Allied Transactions" :
    location.pathname.startsWith("/work-queue") ? "Service Work Queue" :
    location.pathname.startsWith("/tank-information") ? "Tank Information" :
    location.pathname.startsWith("/tank-charts") ? "Tank Charts" :
    "Portfolio Command Center";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={jobber?.logoUrl || xpLogo} alt={jobber?.name || "XProtean logo"} className="brand-logo" />
        </div>
        <nav className="side-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "") }>
            Portfolio
          </NavLink>
          <NavLink to="/work-queue" className={({ isActive }) => (isActive ? "active" : "") }>
            Work Queue
          </NavLink>
          <NavLink to="/tank-information" className={({ isActive }) => (isActive ? "active" : "") }>
            Tank Information
          </NavLink>
          <NavLink to="/tank-charts" className={({ isActive }) => (isActive ? "active" : "") }>
            Tank Charts
          </NavLink>
          <NavLink to="/allied" className={({ isActive }) => (isActive ? "active" : "") }>
            Allied
          </NavLink>
          <NavLink to="/allied-mgmt" className={({ isActive }) => (isActive ? "active" : "") }>
            Allied Mgmt
          </NavLink>
          {user?.jobberRole === "admin" || user?.role === "system_manager" ? (
            <NavLink to="/management" className={({ isActive }) => (isActive ? "active" : "") }>
              Users
            </NavLink>
          ) : null}
          <NavLink to="/pricing" className={({ isActive }) => (isActive ? "active" : "") }>
            Pricing
          </NavLink>
          <NavLink to="/price-tables" className={({ isActive }) => (isActive ? "active" : "") }>
            Price Tables
          </NavLink>
          <NavLink to="/mobile-prices" className={({ isActive }) => (isActive ? "active" : "") }>
            Mobile Prices
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "") }>
            Admin
          </NavLink>
        </nav>
      </aside>
      <section className="main-shell">
        <header className="topbar">
          <div>
            <div className="topbar-title">{pageTitle}</div>
            <div className="topbar-subtitle">Gas Station Monitoring Dashboard</div>
          </div>
          <div className="topbar-user">
            <div>
              <div className="topbar-user-name">{user?.name || "Local User"}</div>
              <div className="topbar-user-meta">
                {user?.jobberRole || user?.role || "guest"}
                {user?.email ? ` • ${user.email}` : ""}
              </div>
              <div className="topbar-user-meta">{jobber?.name || "No jobber selected"}</div>
            </div>
            <button type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </section>
    </div>
  );
}

function ProtectedApp({ user, jobber, onLogout, onJobberUpdated }) {
  return (
    <AppFrame user={user} jobber={jobber} onLogout={onLogout}>
      <Routes>
        <Route path="/" element={<PortfolioPage />} />
        <Route path="/portfolio" element={<Navigate to="/" replace />} />
        <Route path="/work-queue" element={<WorkQueuePage />} />
        <Route path="/tank-information" element={<TankInformationPage />} />
        <Route path="/tank-charts" element={<TankChartsPage />} />
        <Route path="/allied" element={<AlliedPage />} />
        <Route path="/allied-mgmt" element={<AlliedMgmtPage />} />
        <Route path="/management" element={user?.jobberRole === "admin" || user?.role === "system_manager" ? <ManagementPage /> : <Navigate to="/" replace />} />
        <Route
          path="/pricing"
          element={
            <Suspense fallback={<div className="login-status">Loading pricing dashboard...</div>}>
              <PricingPage />
            </Suspense>
          }
        />
        <Route path="/price-tables" element={<PriceTablesPage />} />
        <Route path="/mobile-prices" element={<MobilePricesPage />} />
        <Route path="/admin" element={<AdminPage user={user} jobber={jobber} onJobberUpdated={onJobberUpdated} />} />
        <Route path="/sites/:siteId" element={<SiteDetailPage />} />
        <Route path="/sites/:siteId/layout" element={<LayoutPage />} />
        <Route path="/sites/:siteId/layout/edit" element={<LayoutEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppFrame>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [jobber, setJobber] = useState(null);
  const [sessionError, setSessionError] = useState("");

  async function restoreSession() {
    if (!getToken()) {
      setSessionError("");
      setStatus("guest");
      return;
    }

    setStatus("loading");
    setSessionError("");

    try {
      const sessionUser = await api.getSessionUser();
      let sessionJobber = null;
      try {
        sessionJobber = await api.getCurrentJobber();
      } catch (_error) {
        sessionJobber = null;
      }
      setUser(sessionUser);
      setJobber(sessionJobber);
      setStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (message.startsWith("401:") || message.startsWith("403:") || message.startsWith("404:")) {
        logout();
        setUser(null);
        setJobber(null);
        setSessionError("");
        setStatus("guest");
        return;
      }

      setUser(null);
      setJobber(null);
      setSessionError(message || "The API is unavailable.");
      setStatus("api-unavailable");
    }
  }

  useEffect(() => {
    restoreSession();
  }, []);

  async function handleAuthenticated(nextUser) {
    let nextJobber = null;
    try {
      nextJobber = await api.getCurrentJobber();
    } catch (_error) {
      nextJobber = null;
    }
    setUser(nextUser);
    setJobber(nextJobber);
    setSessionError("");
    setStatus("ready");
  }

  function handleLogout() {
    logout();
    setUser(null);
    setJobber(null);
    setSessionError("");
    setStatus("guest");
    navigate("/login", { replace: true });
  }

  if (status === "loading") return <div className="login-status">Checking local session...</div>;
  if (status === "api-unavailable") {
    return (
      <div className="login-status">
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <div>Stored session found, but the API is unavailable.</div>
          <div style={{ marginTop: 12, fontWeight: 500, fontSize: 14 }}>{sessionError || "Start the local API and retry."}</div>
          <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={restoreSession}>Retry session</button>
            <button type="button" onClick={handleLogout}>Clear saved session</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === "ready" ? <Navigate to="/" replace /> : <LoginPage onAuthenticated={handleAuthenticated} />}
      />
      <Route
        path="/auth/callback"
        element={<AuthCallbackPage onAuthenticated={handleAuthenticated} />}
      />
      <Route
        path="/*"
        element={
          status === "ready" ? (
            <ProtectedApp
              user={user}
              jobber={jobber}
              onLogout={handleLogout}
              onJobberUpdated={setJobber}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
