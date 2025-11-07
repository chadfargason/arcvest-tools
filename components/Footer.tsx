export default function Footer() {
  return (
    <footer className="bg-[#0f172a] text-white">
      {/* Primary Footer Section */}
      <div className="bg-[#06140c] border-t border-[rgba(230,230,230,0.57)] py-16 md:py-20">
        <div className="mx-auto max-w-container px-5">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-12">
            {/* Branding */}
            <div>
              <p className="text-[#eff2ff]">Welcome to a better investing experience.</p>
              <div className="my-6">
                <a href="https://arcvest.com" className="inline-block">
                  <img
                    src="https://arcvest.com/wp-content/uploads/2025/10/Adobe-Express-file-300x300.png"
                    alt="ArcVest Logo"
                    width={190}
                    height={190}
                  />
                </a>
              </div>

              <div className="mt-5">
                <a
                  href="http://www.instagram.com/arcvest.wealth"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="text-[#eff2ff] transition-colors duration-200 hover:text-arcvest-teal"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 448 512"
                    width="24"
                    height="24"
                    fill="currentColor"
                  >
                    <path d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Placeholder columns for future content */}
            <div className="hidden lg:block" />
            <div className="hidden lg:block" />

            {/* Contact Information */}
            <div>
              <h2
                className="mb-5 text-lg font-normal"
                style={{ color: '#FFFFFF' }}
              >
                Get In Touch
              </h2>
              <p className="text-[#eff2ff] leading-relaxed">
                790 Boylston, Boston, MA 02199
                <br />
                wealth@arcvest.com
                <br />
                713-581-4550
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Bottom Bar */}
      <div className="bg-[#06140c] border-t border-[rgba(81,86,129,0.72)] py-5">
        <div className="mx-auto max-w-container px-5">
          <p className="text-center text-[#eff2ff]">Copyright © 2025 ArcVest | Powered by ArcVest</p>
        </div>
      </div>
    </footer>
  )
}

