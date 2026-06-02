import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HomeScreen } from './components/HomeScreen';
import { Workspace } from './components/Workspace';
import type { SeedTemplate } from './db/seedData';

function App() {
  const [currentView, setCurrentView] = useState<'HOME' | 'WORKSPACE'>('HOME');
  const [readOnlyMode, setReadOnlyMode] = useState(false);
  const [templateToPreview, setTemplateToPreview] = useState<SeedTemplate | undefined>(undefined);

  // Preloader state & staggered texts
  const [isLoading, setIsLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('INITIALIZING INDEXEDDB PERSISTENCE...');
  
  // PWA Installer states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  
  // iOS Safari PWA support
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstallModal, setShowIOSInstallModal] = useState(false);

  // Chromium checker state
  const [showChromiumModal, setShowChromiumModal] = useState(false);

  // Press back again to exit states & effects
  const [showExitModal, setShowExitModal] = useState(false);
  const lastBackPress = useRef<number>(0);

  // Double back to exit handler on HOME screen
  useEffect(() => {
    if (isLoading) return; // Wait until preloader is done
    if (currentView !== 'HOME') return;

    // Push dummy history entry if not already pushed to intercept Back button
    if (window.history.state?.view !== 'HOME') {
      window.history.pushState({ view: 'HOME' }, '', window.location.href);
    }

    const handlePopState = () => {
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        // Exit the app by going back past our dummy base state
        window.history.back();
      } else {
        // Re-lock the navigation by pushing dummy state back
        window.history.pushState({ view: 'HOME' }, '', window.location.href);
        lastBackPress.current = now;
        setShowExitModal(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentView, isLoading]);

  // Auto-dismiss exit modal toast
  useEffect(() => {
    if (showExitModal) {
      const timer = setTimeout(() => {
        setShowExitModal(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [showExitModal]);

  // Stagger loading texts during splash preloader
  useEffect(() => {
    const texts = [
      'RESOLVING GENEALOGICAL COHORTS...',
      'VERIFYING VECTOR BLUEPRINT COMPILES...',
      'OPTIMIZING OFFLINE PWA CACHE...',
      'ESTABLISHING LINEATREE GRAPH MEMORY...'
    ];
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < texts.length) {
        setLoadingText(texts[idx]);
        idx++;
      }
    }, 350);

    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1600);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  // Capture PWA installation trigger prompt (Chrome/Android/PC/Firefox Mobile)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Detect if already installed/standalone
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (isStandalone) {
      setIsInstallable(false);
      setIsIOS(false);
    } else {
      // Check if iOS Apple device specifically (which doesn't support beforeinstallprompt)
      const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      if (isIOSDevice) {
        setIsIOS(true);
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // Check for Chromium-based browser
  useEffect(() => {
    const timer = setTimeout(() => {
      const isChromium = !!(window as any).chrome || /Chrome|Edge|Chromium/i.test(navigator.userAgent);
      const isWarnDismissed = localStorage.getItem('chromium_warn_dismissed') === 'true';
      const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      
      // Do not warn iOS users as they are forced to use Safari WebKit engine anyway
      if (!isChromium && !isWarnDismissed && !isIOSDevice) {
        setShowChromiumModal(true);
      }
    }, 2400);

    return () => clearTimeout(timer);
  }, []);

  const handleInstallPWA = async () => {
    if (isIOS) {
      // For iOS Safari, show step-by-step glassmorphic guide modal
      setShowIOSInstallModal(true);
      return;
    }
    
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setDeferredPrompt(null);
    }
  };

  const handleEnterWorkspace = (readOnly: boolean, template?: SeedTemplate) => {
    setReadOnlyMode(readOnly);
    setTemplateToPreview(template);
    setCurrentView('WORKSPACE');
  };

  const handleBackToHome = () => {
    setCurrentView('HOME');
    setTemplateToPreview(undefined);
  };

  const appIsInstallable = isInstallable || isIOS;

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#282C34] text-[#ABB2BF] relative">
      {/* 1. Gorgeous Neo-DNA Preloader Screen */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="preloader"
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: '#21252B',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '32px'
            }}
          >
            {/* Glowing neon spinner */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
              style={{
                width: '80px',
                height: '80px',
                position: 'relative'
              }}
            >
              {[...Array(8)].map((_, i) => {
                const angle = (i * Math.PI) / 4;
                const r = 28;
                const x = 40 + r * Math.cos(angle);
                const y = 40 + r * Math.sin(angle);
                return (
                  <motion.div
                    key={i}
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 1, 0.3],
                      backgroundColor: ['#61AFEF', '#C678DD', '#98C379', '#56B6C2'][i % 4]
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.8,
                      delay: i * 0.2
                    }}
                    style={{
                      position: 'absolute',
                      left: `${x - 5}px`,
                      top: `${y - 5}px`,
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      boxShadow: '0 0 10px currentColor'
                    }}
                  />
                );
              })}
            </motion.div>

            {/* Loading text typography */}
            <div style={{ textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.12em' }}>
              <motion.h2
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ fontSize: '18px', fontWeight: '900', color: '#61AFEF', marginBottom: '8px' }}
              >
                LINEATREE
              </motion.h2>
              <div style={{ fontSize: '9px', color: 'rgba(171, 178, 191, 0.4)' }}>
                {loadingText}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Main Application Router Views */}
      <AnimatePresence mode="wait">
        {currentView === 'HOME' ? (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full h-full"
          >
            <HomeScreen 
              onEnterWorkspace={handleEnterWorkspace} 
              isInstallable={appIsInstallable}
              onInstallPWA={handleInstallPWA}
            />
          </motion.div>
        ) : (
          <motion.div
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full h-full"
          >
            <Workspace
              readOnly={readOnlyMode}
              initialTemplateNodes={templateToPreview?.nodes}
              initialTemplateEdges={templateToPreview?.edges}
              onBackToHome={handleBackToHome}
              isInstallable={appIsInstallable}
              onInstallPWA={handleInstallPWA}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Non-Chromium Browser Warning Checker Modal */}
      <AnimatePresence>
        {showChromiumModal && (
          <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
              style={{
                maxWidth: '420px',
                border: '1px solid rgba(229, 192, 123, 0.3)',
                boxShadow: '0 0 24px rgba(229, 192, 123, 0.15)'
              }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#E5C07B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-circle-exclamation"></i> Browser Recommendation
                </h3>
                <button
                  onClick={() => setShowChromiumModal(false)}
                  className="modal-btn-close"
                >
                  ×
                </button>
              </div>

              <div style={{ margin: '16px 0', fontSize: '13px', color: '#ABB2BF', lineHeight: 1.5 }}>
                We detected that you are accessing LineaTree from a non-Chromium browser.
                <br /><br />
                For optimal vector graphics canvas performance, stable IndexedDB persistent memory, and high-fidelity PDF blueprints printing, we highly recommend using <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.
              </div>

              <div className="modal-actions" style={{ marginTop: '20px', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => {
                    localStorage.setItem('chromium_warn_dismissed', 'true');
                    setShowChromiumModal(false);
                  }}
                  className="btn-confirm"
                  style={{ background: '#E5C07B', color: '#1E222B', fontWeight: 'bold', width: '100%', justifyContent: 'center', padding: '12px' }}
                >
                  Do Not Show Again
                </button>
                <button
                  onClick={() => setShowChromiumModal(false)}
                  className="btn-cancel"
                  style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                >
                  Continue Anyway
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. iOS Safari PWA Installation Step-by-Step Guide Modal */}
      <AnimatePresence>
        {showIOSInstallModal && (
          <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-content"
              style={{
                maxWidth: '420px',
                border: '1px solid rgba(97, 175, 239, 0.3)',
                boxShadow: '0 0 24px rgba(97, 175, 239, 0.15)'
              }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#61AFEF', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-mobile-screen-button"></i> iOS Installation Guide
                </h3>
                <button
                  onClick={() => setShowIOSInstallModal(false)}
                  className="modal-btn-close"
                >
                  ×
                </button>
              </div>

              <div style={{ margin: '16px 0', fontSize: '13px', color: '#ABB2BF', lineHeight: 1.6, textAlign: 'left' }}>
                To install **LineaTree** on your iPhone or iPad, follow these simple Safari steps:
                <br /><br />
                1. Tap the **Share** icon at the bottom of the screen <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>[⎋]</span>.
                <br />
                2. Scroll down the menu and select **'Add to Home Screen'** <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>[+]</span>.
                <br />
                3. Tap **'Add'** in the top right corner.
                <br /><br />
                The app will appear as a desktop launcher card on your screen and run entirely offline with dedicated database stability!
              </div>

              <div className="modal-actions" style={{ marginTop: '20px' }}>
                <button
                  onClick={() => setShowIOSInstallModal(false)}
                  className="btn-confirm"
                  style={{ background: '#61AFEF', color: '#1E222B', fontWeight: 'bold', width: '100%', justifyContent: 'center', padding: '12px' }}
                >
                  Got It, Thanks!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. Press Back Again to Exit App Toast */}
      <AnimatePresence>
        {showExitModal && (
          <motion.div
            initial={{ opacity: 0, y: 40, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            style={{
              position: 'fixed',
              bottom: '48px',
              left: '50%',
              zIndex: 100000,
              background: 'rgba(30, 34, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(224, 108, 117, 0.35)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
              borderRadius: '12px',
              padding: '12px 20px',
              color: '#E06C75',
              fontWeight: 'bold',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              pointerEvents: 'none'
            }}
          >
            <span style={{ fontSize: '14px' }}>🚪</span> Press back again to exit the app
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
