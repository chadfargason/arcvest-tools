'use client'

import { useState, useEffect } from 'react'

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const menu = document.getElementById('main-menu')
      const toggle = document.querySelector('.mobile-menu-toggle')

      if (menu && toggle && !menu.contains(event.target as Node) && !toggle.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const toggleMenu = () => setMenuOpen((open) => !open)
  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="site-header ast-theme-transparent-header" id="masthead">
      <style jsx>{`
        .site-header {
          background-color: transparent;
          padding: 0;
        }

        .ast-above-header-wrap {
          border-bottom: 1px solid rgb(234, 234, 234);
          padding: 1em 0;
        }

        .main-header-bar {
          padding: 0.5em 0;
        }

        .disclaimer-bar {
          background: #ffffff;
          color: #0F172A;
          font-family: 'Lora', serif;
          font-size: 13px;
          letter-spacing: 1px;
          text-transform: uppercase;
          font-weight: 600;
          text-align: center;
          padding: 8px 0;
          border-bottom: 1px solid rgba(69, 79, 94, 0.2);
        }

        .container {
          max-width: 1240px;
          margin: 0 auto;
          padding: 0 20px;
        }

        .site-branding {
          display: flex;
          align-items: center;
        }

        .site-logo-text {
          font-family: 'Lato', sans-serif;
          font-size: 32px;
          font-weight: 700;
          color: #0F172A;
          text-decoration: none;
          letter-spacing: -0.5px;
        }

        .ast-theme-transparent-header .site-logo-text {
          color: #FFFFFF;
        }

        .main-navigation {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          width: 100%;
        }

        .main-navigation ul {
          list-style: none;
          display: flex;
          gap: 0;
          margin: 0;
          padding: 0;
          background-color: rgb(34, 34, 34);
          height: 32px;
          align-items: center;
        }

        .main-navigation li {
          margin: 0;
          height: 32px;
          display: flex;
          align-items: center;
        }

        .main-navigation a {
          display: flex;
          align-items: center;
          font-family: 'Lora', serif;
          font-size: 21px;
          font-weight: 400;
          color: #FFFFFF;
          padding: 0 20px;
          height: 32px;
          transition: all 0.3s ease;
          text-decoration: none;
        }

        .main-navigation a:hover {
          background-color: #1B9C85;
          color: #FFFFFF;
        }

        .mobile-menu-toggle {
          display: none;
          background: none;
          border: none;
          cursor: pointer;
          padding: 10px;
          z-index: 1000;
        }

        .mobile-menu-toggle svg {
          width: 30px;
          height: 30px;
          fill: #FFFFFF;
        }

        .ast-theme-transparent-header #masthead {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 999;
          background-color: transparent;
        }

        .ast-theme-transparent-header .ast-above-header-wrap,
        .ast-theme-transparent-header .main-header-bar {
          background: rgba(30, 35, 45, 0.55);
        }

        @media (max-width: 768px) {
          .mobile-menu-toggle {
            display: block;
          }

          .main-navigation {
            position: relative;
          }

          .main-navigation ul {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            flex-direction: column;
            background-color: #FFFFFF;
            box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            width: 100%;
            z-index: 999;
            height: auto;
          }

          .main-navigation ul.active {
            display: flex;
          }

          .main-navigation li {
            width: 100%;
            height: auto;
          }

          .main-navigation a {
            color: #454F5E;
            width: 100%;
            height: auto;
            padding: 15px 20px;
          }

          .main-navigation a:hover {
            background-color: #1B9C85;
            color: #FFFFFF;
          }
        }
      `}</style>

      <div className="ast-above-header-wrap">
        <div className="container">
          <div className="site-branding">
            <a href="https://arcvest.com/" rel="home" className="site-logo-text">
              ArcVest
            </a>
          </div>
        </div>
      </div>

      <div className="main-header-bar">
        <div className="container">
          <nav className="main-navigation" aria-label="Primary Site Navigation">
            <button
              className="mobile-menu-toggle"
              aria-label="Toggle Menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
                <path d="M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z" />
              </svg>
            </button>

            <ul className={`main-menu ${menuOpen ? 'active' : ''}`} id="main-menu">
              <li><a href="https://arcvest.com/" onClick={closeMenu}>Home</a></li>
              <li><a href="https://arcvest.com/about/" onClick={closeMenu}>About</a></li>
              <li><a href="https://arcvest.com/faqs/" onClick={closeMenu}>FAQs</a></li>
              <li><a href="https://arcvest.com/contact/" onClick={closeMenu}>Contact</a></li>
              <li><a href="https://arcvest.com/disclosure-fees/" onClick={closeMenu}>Disclosure & Fees</a></li>
              <li><a href="/" onClick={closeMenu}>Investment Tools</a></li>
            </ul>
          </nav>
        </div>
      </div>

      <div className="disclaimer-bar">
        For Information and Education Use Only – Not Advice
      </div>
    </header>
  )
}

