import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { PageHeader, StatePanel } from "./components/primitives.js";
import { pages } from "./routes.js";
import { FarmRegistry, useFarms } from "./farms.js";
import { FarmMembersPage } from "./farm-members.js";
import { UnitRegistry } from "./units.js";
import { AuthScreen } from "./auth.js";
import {
  authRequest,
  isUnauthenticatedAuthError,
  setCsrfToken,
  type AuthData,
} from "./auth-api.js";
import { DashboardHome } from "./dashboard.js";
import { FishUnitDetail } from "./farming/fish.js";
import { ChickenUnitDetail } from "./farming/chicken.js";
import { CropUnitDetail } from "./farming/crops.js";
import { CycleDetailPage, CycleWorkspace } from "./farming/cycle.js";
import { SchedulePage } from "./schedule.js";
import { InventoryItemPage, InventoryPage } from "./inventory.js";
import { CostsPage } from "./finance/costs.js";
import { ProductsPage } from "./products.js";
import { HarvestPage } from "./harvest.js";
import { SalesPage } from "./sales.js";
import { AnalyticsPage } from "./analytics.js";
import { HppPage } from "./finance/hpp.js";
import { WastePage } from "./waste.js";
import { MaggotPage } from "./maggot.js";
import { WaterTransferPage } from "./water-transfer.js";
import { NotificationsPage } from "./notifications.js";
import { DevicesPage } from "./devices.js";
import { Icon, type IconName } from "./icons.js";
import "./styles.css";

const navIcons: Record<(typeof pages)[number]["path"], IconName> = {
  "/dashboard": "home",
  "/notifications": "bell",
  "/farms": "farm",
  "/farm/members": "farm",
  "/farm/fish": "fish",
  "/farm/chicken": "chicken",
  "/farm/crops": "crop",
  "/cycles": "cycle",
  "/schedule": "calendar",
  "/inventory": "package",
  "/waste": "recycle",
  "/maggot": "recycle",
  "/circular/water-transfers": "crop",
  "/devices": "activity",
  "/harvest": "harvest",
  "/products": "package",
  "/sales": "cart",
  "/finance/costs": "wallet",
  "/finance/hpp": "chart",
  "/analytics": "chart",
};

function ModulePage({ page }: { page: (typeof pages)[number] }) {
  return (
    <>
      <PageHeader
        eyebrow={page.group}
        title={page.label}
        description={page.description}
      />
      <section className="module-placeholder" aria-labelledby="module-title">
        <span className="module-placeholder-icon">
          <Icon name={navIcons[page.path]} size={30} />
        </span>
        <p className="section-kicker">Dalam pengembangan</p>
        <h2 id="module-title">{page.label} sedang disiapkan</h2>
        <p>
          Pencatatan {page.label.toLowerCase()} belum tersedia. Kelola farm dan
          unit yang sudah aktif sambil menunggu modul ini.
        </p>
        <div className="module-links">
          <Link className="button-link" to="/farms">
            Kelola farm <Icon name="arrow" size={17} />
          </Link>
          <Link to="/farm/fish">Lihat unit farm</Link>
        </div>
      </section>
    </>
  );
}

function Shell({
  auth,
  onLogout,
  logoutError,
}: {
  auth: AuthData;
  onLogout: () => void;
  logoutError: string | null;
}) {
  const farmState = useFarms();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const currentPage = pages.find((page) => page.path === location.pathname);
  const currentLabel =
    currentPage?.label ??
    (location.pathname.startsWith("/farm/fish/")
      ? "Detail kolam"
      : location.pathname.startsWith("/farm/chicken/")
        ? "Detail kandang"
        : location.pathname.startsWith("/farm/crops/")
          ? "Detail area tanam"
          : location.pathname.startsWith("/cycles/")
            ? "Detail siklus"
            : location.pathname.startsWith("/inventory/")
              ? "Detail item"
              : "Halaman");
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Ke konten utama
      </a>
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <Link
            className="brand"
            to="/dashboard"
            onClick={() => setMenuOpen(false)}
          >
            <span className="brand-mark">
              <img src="/jagofarm-logo.png" alt="" />
            </span>
            <span className="brand-copy">
              <strong>OpSmart</strong>
              <small>by JagoFarm</small>
            </span>
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Tutup" : "Menu"}
          </button>
        </div>
        <nav id="primary-nav" aria-label="Navigasi utama">
          {pages.map((p, i) => (
            <React.Fragment key={p.path}>
              {(i === 0 || pages[i - 1]?.group !== p.group) && (
                <p className="nav-group">{p.group}</p>
              )}
              <NavLink to={p.path} onClick={() => setMenuOpen(false)}>
                <Icon name={navIcons[p.path]} size={19} />
                <span>{p.label}</span>
              </NavLink>
            </React.Fragment>
          ))}
        </nav>
        <p className="sidebar-note">
          <span className="sidebar-note-icon">
            <Icon name="crop" size={21} />
          </span>
          <span>
            Ruang kerja
            <br />
            operasional JagoFarm
          </span>
        </p>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="topbar">
          <div className="topbar-path">
            <Icon name="home" size={16} />
            <span>Ruang kerja</span>
            <span aria-hidden="true">/</span>
            <strong>{currentLabel}</strong>
          </div>
          <div className="farm-switch">
            <span className="account-meta" title={auth.user.email}>
              <span className="account-status-dot" aria-hidden="true" />
              <span className="account-name">
                {auth.user.displayName}
                <small>Farm aktif</small>
              </span>
            </span>
            <label className="visually-hidden" htmlFor="active-farm">
              Farm aktif
            </label>
            <select
              id="active-farm"
              value={farmState.activeId ?? ""}
              disabled={farmState.loading || !farmState.farms.length}
              onChange={(event) => farmState.setActiveId(event.target.value)}
            >
              {!farmState.farms.length && (
                <option value="">Belum ada farm</option>
              )}
              {farmState.farms.map((farm) => (
                <option key={farm.id} value={farm.id}>
                  {farm.name}
                </option>
              ))}
            </select>
            <Link className="farm-manage-link" to="/farms">
              Kelola farm
            </Link>
            <span className="account-avatar" aria-hidden="true">
              {auth.user.displayName.slice(0, 2).toUpperCase()}
            </span>
            <button type="button" className="logout-button" onClick={onLogout}>
              Keluar
            </button>
            {logoutError && <span role="alert">{logoutError}</span>}
          </div>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={<DashboardHome state={farmState} />}
            />
            <Route
              path="/notifications"
              element={<NotificationsPage state={farmState} />}
            />
            <Route path="/farms" element={<FarmRegistry state={farmState} />} />
            <Route
              path="/farm/members"
              element={<FarmMembersPage state={farmState} />}
            />
            <Route
              path="/farm/fish"
              element={<UnitRegistry state={farmState} type="FISH" />}
            />
            <Route
              path="/farm/fish/:unitId"
              element={<FishUnitDetail state={farmState} />}
            />
            <Route
              path="/farm/chicken"
              element={<UnitRegistry state={farmState} type="CHICKEN" />}
            />
            <Route
              path="/farm/chicken/:unitId"
              element={<ChickenUnitDetail state={farmState} />}
            />
            <Route
              path="/farm/crops"
              element={<UnitRegistry state={farmState} type="CROP" />}
            />
            <Route
              path="/farm/crops/:unitId"
              element={<CropUnitDetail state={farmState} />}
            />
            <Route
              path="/cycles"
              element={<CycleWorkspace state={farmState} />}
            />
            <Route
              path="/cycles/:cycleId"
              element={<CycleDetailPage state={farmState} />}
            />
            <Route
              path="/schedule"
              element={<SchedulePage state={farmState} />}
            />
            <Route
              path="/inventory"
              element={<InventoryPage state={farmState} />}
            />
            <Route path="/waste" element={<WastePage state={farmState} />} />
            <Route path="/maggot" element={<MaggotPage state={farmState} />} />
            <Route
              path="/circular/water-transfers"
              element={<WaterTransferPage state={farmState} />}
            />
            <Route
              path="/devices"
              element={<DevicesPage state={farmState} />}
            />
            <Route
              path="/inventory/:itemId"
              element={<InventoryItemPage state={farmState} />}
            />
            <Route
              path="/finance/costs"
              element={<CostsPage state={farmState} />}
            />
            <Route
              path="/products"
              element={<ProductsPage state={farmState} />}
            />
            <Route
              path="/harvest"
              element={<HarvestPage state={farmState} />}
            />
            <Route path="/sales" element={<SalesPage state={farmState} />} />
            <Route
              path="/analytics"
              element={<AnalyticsPage state={farmState} />}
            />
            <Route
              path="/finance/hpp"
              element={<HppPage state={farmState} />}
            />
            {pages
              .filter(
                (p) =>
                  ![
                    "/farms",
                    "/farm/members",
                    "/dashboard",
                    "/notifications",
                    "/farm/fish",
                    "/farm/chicken",
                    "/farm/crops",
                    "/cycles",
                    "/schedule",
                    "/inventory",
                    "/waste",
                    "/maggot",
                    "/circular/water-transfers",
                    "/devices",
                    "/harvest",
                    "/products",
                    "/sales",
                    "/analytics",
                    "/finance/costs",
                    "/finance/hpp",
                  ].includes(p.path),
              )
              .map((p) => (
                <Route
                  key={p.path}
                  path={p.path}
                  element={<ModulePage page={p} />}
                />
              ))}
            <Route
              path="*"
              element={
                <StatePanel kind="error" title="Halaman tidak ditemukan">
                  <Link to="/dashboard">Kembali ke dashboard</Link>
                </StatePanel>
              }
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}
function AuthGate() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    authRequest<AuthData>("me")
      .then((data) => {
        if (active) {
          setCsrfToken(data.csrfToken);
          setAuth(data);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCsrfToken(null);
          if (isUnauthenticatedAuthError(error)) {
            setAuth(null);
            setSessionError(false);
          } else {
            setSessionError(true);
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => {
      setCsrfToken(null);
      setAuth(null);
      setSessionError(false);
    };
    window.addEventListener("opsmart-auth-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("opsmart-auth-expired", expired);
    };
  }, [sessionAttempt]);
  function retrySession() {
    setSessionError(false);
    setLoading(true);
    setSessionAttempt((attempt) => attempt + 1);
  }
  function onAuth(data: AuthData) {
    setCsrfToken(data.csrfToken);
    setAuth(data);
  }
  async function logout() {
    setLogoutError(null);
    try {
      await authRequest("logout", {});
      setCsrfToken(null);
      setAuth(null);
      localStorage.removeItem("opsmart-active-farm-v1");
    } catch {
      setLogoutError("Gagal keluar. Coba lagi.");
    }
  }
  if (loading)
    return (
      <div className="auth-loading">
        <StatePanel kind="loading" title="Memeriksa sesi">
          Mohon tunggu.
        </StatePanel>
      </div>
    );
  if (sessionError)
    return (
      <div className="auth-loading">
        <StatePanel
          kind="error"
          title="Sesi belum tersedia"
          onRetry={retrySession}
        >
          Sesi belum dapat diperiksa. Periksa koneksi lalu coba lagi.
        </StatePanel>
      </div>
    );
  return auth ? (
    <Shell
      auth={auth}
      onLogout={() => void logout()}
      logoutError={logoutError}
    />
  ) : (
    <AuthScreen onAuth={onAuth} />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate />
    </BrowserRouter>
  </React.StrictMode>,
);
