import React, { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import "./layout.css";

const Layout = ({ children }) => {
  const [isNavOpen, setIsNavOpen] = useState(false);

  return (
    <div className="layout-root">
      <div className="layout-background">
        <div className="layout-background-texture"></div>
        <div className="layout-background-radial"></div>
      </div>

      <nav className="layout-nav animate-fade-in-down">
        <div className="layout-nav-inner">
          <div className="layout-brand font-cinzel">THE BABEL</div>
          
          <div className="layout-nav-links font-garamond">
            <Link to="/" className="layout-nav-link">Home</Link>
            <Link to="/translate" className="layout-nav-link">Translate</Link>
            <Link to="/features" className="layout-nav-link">Features</Link>
          </div>

          <button className="layout-mobile-toggle" onClick={() => setIsNavOpen(!isNavOpen)}>
            {isNavOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
        
        {isNavOpen && (
          <div className="layout-mobile-menu">
            <nav className="layout-mobile-links font-garamond">
              <Link to="/" className="layout-mobile-link" onClick={() => setIsNavOpen(false)}>Home</Link>
              <Link to="/translate" className="layout-mobile-link" onClick={() => setIsNavOpen(false)}>Translate</Link>
              <Link to="/features" className="layout-mobile-link" onClick={() => setIsNavOpen(false)}>Features</Link>
            </nav>
          </div>
        )}
      </nav>

      <main className="layout-main">
        {children ?? <Outlet />}
      </main>

      <footer className="layout-footer">
         <div className="layout-footer-dots">
           <div className="layout-footer-dot"></div>
           <div className="layout-footer-dot"></div>
           <div className="layout-footer-dot"></div>
         </div>
         <p className="layout-footer-text font-cinzel">
           PROJECT BABEL © {new Date().getFullYear()}
         </p>
      </footer>
    </div>
  );
};

export default Layout;
