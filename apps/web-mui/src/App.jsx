import { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Alert,
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import LocalGasStationIcon from "@mui/icons-material/LocalGasStation";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import OilBarrelIcon from "@mui/icons-material/OilBarrel";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import PaymentsIcon from "@mui/icons-material/Payments";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import UpgradeIcon from "@mui/icons-material/SystemUpdateAlt";
import TableChartIcon from "@mui/icons-material/TableChart";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import MenuIcon from "@mui/icons-material/Menu";
import LogoutIcon from "@mui/icons-material/Logout";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, getToken, logout } from "./api";
import { DashboardPage } from "./pages/DashboardPage";
import { SitesPage } from "./pages/SitesPage";
import { PricingPreviewPage } from "./pages/PricingPreviewPage";
import { AdminPreviewPage } from "./pages/AdminPreviewPage";
import { TankInformationPage } from "./pages/TankInformationPage";
import { TankChartsPage } from "./pages/TankChartsPage";
import { AlliedPage } from "./pages/AlliedPage";
import { AlliedMgmtPage } from "./pages/AlliedMgmtPage";
import { AlliedUpgradesPage } from "./pages/AlliedUpgradesPage";
import { EbolPage } from "./pages/EbolPage";
import { PriceTablesPage } from "./pages/PriceTablesPage";
import { LoginPage } from "./pages/LoginPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const drawerWidth = 280;

const navItems = [
  { label: "Dashboard", to: "/", icon: <DashboardIcon /> },
  { label: "Sites", to: "/sites", icon: <LocalGasStationIcon /> },
  { label: "Tank Info", to: "/tank-information", icon: <OilBarrelIcon /> },
  { label: "Tank Charts", to: "/tank-charts", icon: <ShowChartIcon /> },
  { label: "Allied", to: "/allied", icon: <PaymentsIcon /> },
  { label: "Allied Mgmt", to: "/allied-mgmt", icon: <ManageAccountsIcon /> },
  { label: "Allied Upgrades", to: "/allied-upgrades", icon: <UpgradeIcon /> },
  { label: "eBOL", to: "/ebols", icon: <ReceiptLongIcon /> },
  { label: "Pricing", to: "/pricing", icon: <MonetizationOnIcon /> },
  { label: "Price Tables", to: "/price-tables", icon: <TableChartIcon /> },
  { label: "Admin", to: "/admin", icon: <AdminPanelSettingsIcon /> }
];

function PageShell({ user, jobber, onLogout, children }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = useMemo(() => {
    const match = navItems.find((item) => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to));
    return match?.label || "Petroleum";
  }, [location.pathname]);

  const drawerContent = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 3 }}>
        {jobber?.logoUrl ? (
          <Box
            component="img"
            src={jobber.logoUrl}
            alt={jobber?.name || "Jobber logo"}
            sx={{ display: "block", maxWidth: "100%", maxHeight: 56, objectFit: "contain" }}
          />
        ) : (
          <>
            <Typography variant="h6">Petroleum MUI</Typography>
            <Typography variant="body2" color="text.secondary">
              Primary responsive frontend
            </Typography>
          </>
        )}
      </Box>
      <Divider />
      <List sx={{ px: 1.5, py: 2, flex: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              "&.active": {
                backgroundColor: "primary.main",
                color: "primary.contrastText",
                "& .MuiListItemIcon-root": { color: "primary.contrastText" }
              }
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Stack spacing={1} sx={{ p: 2.5 }}>
        <Chip label={jobber?.name || "No jobber selected"} />
        <Typography variant="body2" color="text.secondary">
          {user?.name || "Unknown user"}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {user?.email || ""}
        </Typography>
        <ListItemButton onClick={onLogout} sx={{ borderRadius: 2 }}>
          <ListItemIcon sx={{ minWidth: 40 }}><LogoutIcon /></ListItemIcon>
          <ListItemText primary="Log out" />
        </ListItemButton>
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", backgroundColor: "background.default" }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          borderBottom: "1px solid rgba(15, 23, 42, 0.08)"
        }}
      >
        <Toolbar sx={{ minHeight: 72 }}>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 2, display: { md: "none" } }}>
            <MenuIcon />
          </IconButton>
          <Box sx={{ flex: 1 }}>
            {jobber?.logoUrl ? (
              <Stack spacing={0.5}>
                <Box
                  component="img"
                  src={jobber.logoUrl}
                  alt={jobber?.name || "Jobber logo"}
                  sx={{ display: "block", maxWidth: { xs: 160, sm: 220 }, maxHeight: 40, objectFit: "contain" }}
                />
                <Typography variant="body2" color="text.secondary">
                  {title}
                </Typography>
              </Stack>
            ) : (
              <>
                <Typography variant="h6">Petroleum MUI</Typography>
                <Typography variant="body2" color="text.secondary">
                  {title}
                </Typography>
              </>
            )}
          </Box>
          <Button
            color="primary"
            variant="outlined"
            onClick={
              location.pathname === "/"
                ? () => window.dispatchEvent(new CustomEvent("petroleum:dashboard-home"))
                : () => window.dispatchEvent(new CustomEvent("petroleum:reset-filters"))
            }
          >
            {location.pathname === "/" ? "Map" : "Reset"}
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: drawerWidth }
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" }
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flex: 1, width: { md: `calc(100% - ${drawerWidth}px)` }, overflowX: "hidden" }}>
        <Toolbar sx={{ minHeight: 72 }} />
        <Box sx={{ p: { xs: 2, sm: 3, lg: 4 } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function ProtectedApp({ user, jobber, onLogout, onJobberUpdated }) {
  return (
    <AppErrorBoundary>
      <PageShell user={user} jobber={jobber} onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<DashboardPage jobber={jobber} />} />
          <Route path="/sites" element={<SitesPage jobber={jobber} />} />
          <Route path="/tank-information" element={<TankInformationPage jobber={jobber} />} />
          <Route path="/tank-charts" element={<TankChartsPage jobber={jobber} />} />
          <Route path="/allied" element={<AlliedPage />} />
          <Route path="/allied-mgmt" element={<AlliedMgmtPage />} />
          <Route path="/allied-upgrades" element={<AlliedUpgradesPage />} />
          <Route path="/ebols" element={<EbolPage />} />
          <Route path="/pricing" element={<PricingPreviewPage />} />
          <Route path="/price-tables" element={<PriceTablesPage />} />
          <Route path="/admin" element={<AdminPreviewPage user={user} jobber={jobber} onJobberUpdated={onJobberUpdated} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PageShell>
    </AppErrorBoundary>
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

  function handleJobberUpdated(nextJobber) {
    setJobber(nextJobber);
  }

  function handleLogout() {
    logout();
    setUser(null);
    setJobber(null);
    setSessionError("");
    setStatus("guest");
    navigate("/login", { replace: true });
  }

  if (status === "loading") {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Typography>Checking local session...</Typography>
      </Box>
    );
  }

  if (status === "api-unavailable") {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
        <Alert
          severity="warning"
          action={<IconButton color="inherit" onClick={handleLogout}><LogoutIcon /></IconButton>}
          sx={{ maxWidth: 720 }}
        >
          Stored session found, but the API is unavailable. {sessionError || "Start the local API and retry."}
        </Alert>
      </Box>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={status === "ready" ? <Navigate to="/" replace /> : <LoginPage onAuthenticated={handleAuthenticated} />}
      />
      <Route path="/auth/callback" element={<AuthCallbackPage onAuthenticated={handleAuthenticated} />} />
      <Route
        path="/*"
        element={status === "ready" ? <ProtectedApp user={user} jobber={jobber} onLogout={handleLogout} onJobberUpdated={handleJobberUpdated} /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
