import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import { ToastContainer } from "react-toastify";
import Cameras from "./pages/Cameras.jsx";
import "react-toastify/dist/ReactToastify.css";
import Settings from "./pages/Settings.jsx";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cameras" element={<Cameras />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <ToastContainer />
    </Router>
  );
}

export default App;