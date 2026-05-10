import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import { ToastContainer } from "react-toastify";
import Cameras from "./pages/Cameras.jsx";
import "react-toastify/dist/ReactToastify.css";
import Settings from "./pages/Settings.jsx";
import Login from "./pages/Login.jsx";
import {
  AUTH_EXPIRED_EVENT,
  apiJson,
  clearStoredAuth,
  loadStoredAuth,
  saveStoredAuth
} from "./api.js";

function App() {
  const [auth, setAuth] = useState(() => loadStoredAuth());
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const handleAuthExpired = () => {
      setAuth(null);
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    let isDisposed = false;

    const validateStoredSession = async () => {
      const storedAuth = loadStoredAuth();

      if (!storedAuth?.token) {
        if (!isDisposed) {
          setAuth(null);
          setCheckingSession(false);
        }
        return;
      }

      try {
        const session = await apiJson("/api/auth/me");
        const nextAuth = {
          ...storedAuth,
          user: session.user,
          expiresAt: session.expiresAt
        };
        saveStoredAuth(nextAuth);
        if (!isDisposed) {
          setAuth(nextAuth);
        }
      } catch (error) {
        console.error("Stored session validation failed:", error);
        clearStoredAuth();
        if (!isDisposed) {
          setAuth(null);
        }
      } finally {
        if (!isDisposed) {
          setCheckingSession(false);
        }
      }
    };

    validateStoredSession();

    return () => {
      isDisposed = true;
    };
  }, []);

  const handleAuthenticated = (session) => {
    const nextAuth = {
      token: session.token,
      user: session.user,
      expiresAt: session.expiresAt
    };

    saveStoredAuth(nextAuth);
    setAuth(nextAuth);
  };

  const handleLogout = async () => {
    try {
      await apiJson("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      clearStoredAuth();
      setAuth(null);
    }
  };

  if (checkingSession) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="small muted">Checking session...</div>
        </section>
      </main>
    );
  }

  if (!auth?.token) {
    return (
      <>
        <Login onAuthenticated={handleAuthenticated} />
        <ToastContainer />
      </>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard /*user={auth.user} onLogout={handleLogout}*/ />} />
        <Route path="/cameras" element={<Cameras />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <ToastContainer />
    </Router>
  );
}

export default App;
