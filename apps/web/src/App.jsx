import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, getToken, logout } from "./api";
import { PortfolioPage } from "./pages/PortfolioPage";
import { WorkQueuePage } from "./pages/WorkQueuePage";
import { TankInformationPage } from "./pages/TankInformationPage";
import { TankChartsPage } from "./pages/TankChartsPage";
import { SiteDetailPage } from "./pages/SiteDetailPage";
import { LayoutPage } from "./pages/LayoutPage";
import { LayoutEditorPage } from "./pages/LayoutEditorPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { ManagementPage } from "./pages/ManagementPage";
import xpLogo from "./assets/xprotean-logo.svg";

const PricingPage = lazy(() =>
  import("./pricing/pages/PricingPage").then((module) => ({ default: module.PricingPage }))
);

function AppFrame({ children, user, jobber, onLogout }) {
  const location = useLocation();
  const pageTitle =
    location.pathname.startsWith("/sites/") ? "Site Operations" :
    location.pathname.startsWith("/management") ? "Users" :
    location.pathname.startsWith("/pricing") ? "Pricing" :
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
          {user?.jobberRole === "admin" || user?.role === "system_manager" ? (
            <NavLink to="/management" className={({ isActive }) => (isActive ? "active" : "") }>
              Users
            </NavLink>
          ) : null}
          <NavLink to="/pricing" className={({ isActive }) => (isActive ? "active" : "") }>
            Pricing
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
        <Route path="/management" element={user?.jobberRole === "admin" || user?.role === "system_manager" ? <ManagementPage /> : <Navigate to="/" replace />} />
        <Route
          path="/pricing"
          element={
            <Suspense fallback={<div className="login-status">Loading pricing dashboard...</div>}>
              <PricingPage />
            </Suspense>
          }
        />
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

  useEffect(() => {
    if (!getToken()) {
      setStatus("guest");
      return;
    }

    api.getSessionUser()
      .then(async (sessionUser) => {
        let sessionJobber = null;
        try {
          sessionJobber = await api.getCurrentJobber();
        } catch (_error) {
          sessionJobber = null;
        }
        setUser(sessionUser);
        setJobber(sessionJobber);
        setStatus("ready");
      })
      .catch(() => {
        logout();
        setUser(null);
        setJobber(null);
        setStatus("guest");
      });
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
    setStatus("ready");
  }

  function handleLogout() {
    logout();
    setUser(null);
    setJobber(null);
    setStatus("guest");
    navigate("/login", { replace: true });
  }

  if (status === "loading") return <div className="login-status">Checking local session...</div>;

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
