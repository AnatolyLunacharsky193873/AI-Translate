import { useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import Cover from "../cover_UI/Cover.jsx";
import Layout from "./Layout.jsx";
import HomePgae from "../Pages/HomePgae.jsx";
import Translate from "../Pages/TranslatePage.jsx"
import Features from "../Pages/features.jsx";

export default function App() {
  const [introComplete, setIntroComplete] = useState(false);

  const handleStart = () => {
    setIntroComplete(true);
  };

  return (
    <HashRouter>
      <div className="app-shell">
        <div className={`app-home ${introComplete ? "app-home-visible" : ""}`}>
          <Routes>
            <Route path="/" element={<Layout />}>
            <Route index element={<HomePgae />} />
            <Route path="/translate" element={<Translate/>}/>
            <Route path="/features" element={<Features/>}/>
            </Route>
          </Routes>
        </div>
        <Cover onStart={handleStart} introComplete={introComplete} />
      </div>
    </HashRouter>
  );
}
