import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { TEMPLATES, loadTemplateIntoIndexedDB, type SeedTemplate } from '../db/seedData';
import { PreviewIcon, ArrowRightIcon, PlusIcon, UploadIcon } from './Icons';
import { db } from '../db/indexedDB';

interface HomeScreenProps {
  onEnterWorkspace: (readOnly: boolean, templateToPreview?: SeedTemplate) => void;
  isInstallable: boolean;
  onInstallPWA: () => void;
}

// ─── Card geometry (must mirror CSS) ────────────────────────────────────────
const CARD_GAP = 24;

function getCardWidth() {
  return typeof window !== 'undefined' && window.innerWidth >= 768 ? 360 : 290;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onEnterWorkspace, isInstallable, onInstallPWA }) => {
  // ── Refs ─────────────────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement | null>(null);
  const viewportRef    = useRef<HTMLDivElement | null>(null);
  const fileInputRef   = useRef<HTMLInputElement | null>(null);
  const isDraggingRef  = useRef(false);

  // ── State ─────────────────────────────────────────────────────────────────
  const [customAlert, setCustomAlert] = useState<{ title: string; message: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragging, setIsDragging]   = useState(false);

  const TOTAL = TEMPLATES.length;

  // ── Motion value for the track's x position ───────────────────────────────
  const x = useMotionValue(0);

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Convert a card index to the track x-offset that centres it in the viewport */
  const indexToX = useCallback((idx: number): number => {
    const vw       = viewportRef.current?.clientWidth ?? window.innerWidth;
    const cardW    = getCardWidth();
    const centre   = (vw - cardW) / 2;
    return centre - idx * (cardW + CARD_GAP);
  }, []);

  /** Spring-animate the track to the given card index */
  const snapTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(TOTAL - 1, idx));
    setActiveIndex(clamped);
    animate(x, indexToX(clamped), {
      type:      'spring',
      stiffness: 340,
      damping:   36,
      mass:      0.85,
    });
  }, [x, indexToX, TOTAL]);

  // ── Initial snap + resize re-snap ─────────────────────────────────────────
  useEffect(() => {
    // Need one rAF so viewportRef has a measured width
    const raf = requestAnimationFrame(() => snapTo(0));
    const onResize = () => snapTo(activeIndex);
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mouse-wheel / trackpad scroll ─────────────────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) < 8) return;
        snapTo(activeIndex + (delta > 0 ? 1 : -1));
      }, 40);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(debounceTimer); };
  }, [activeIndex, snapTo]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') snapTo(activeIndex + 1);
      if (e.key === 'ArrowLeft')  snapTo(activeIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, snapTo]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = () => {
    isDraggingRef.current = true;
    setIsDragging(true);
  };

  const handleDragEnd = (_: unknown, info: { velocity: { x: number }; offset: { x: number } }) => {
    isDraggingRef.current = false;
    setIsDragging(false);

    const { velocity, offset } = info;
    const cardW  = getCardWidth();
    const STEP   = cardW + CARD_GAP;

    if (Math.abs(velocity.x) > 350) {
      // velocity flick
      snapTo(activeIndex + (velocity.x < 0 ? 1 : -1));
    } else if (Math.abs(offset.x) > STEP * 0.35) {
      // drag-threshold
      snapTo(activeIndex + (offset.x < 0 ? 1 : -1));
    } else {
      // snap back to current
      snapTo(activeIndex);
    }
  };

  // ── Drag constraints (dynamic) ────────────────────────────────────────────
  const getDragConstraints = () => {
    const vw     = viewportRef.current?.clientWidth ?? window.innerWidth;
    const cardW  = getCardWidth();
    const centre = (vw - cardW) / 2;
    return {
      right: centre,
      left:  centre - (TOTAL - 1) * (cardW + CARD_GAP),
    };
  };

  // ── Particle background ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let W = (canvas.width  = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    type Particle = { x: number; y: number; vx: number; vy: number; r: number; color: string };
    const COLORS  = ['#61AFEF', '#98C379', '#C678DD', '#E5C07B', '#56B6C2'];
    const count   = Math.min(65, Math.floor((W * H) / 16000));
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x:     Math.random() * W,
      y:     Math.random() * H,
      vx:    (Math.random() - 0.5) * 0.45,
      vy:    (Math.random() - 0.5) * 0.45,
      r:     Math.random() * 3 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let mouse = { x: -9999, y: -9999, on: false };
    const onMove  = (e: MouseEvent) => { mouse = { x: e.clientX, y: e.clientY, on: true  }; };
    const onLeave = ()              => { mouse = { x: -9999, y: -9999, on: false }; };
    const onRes   = ()              => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };

    window.addEventListener('mousemove',  onMove);
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize',     onRes);

    const draw = () => {
      ctx.fillStyle = '#282C34';
      ctx.fillRect(0, 0, W, H);

      // Connections
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 135) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(171,178,191,${0.14 * (1 - d / 135)})`;
            ctx.lineWidth   = 1;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Dots
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle   = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = 7;
        ctx.fill();
        ctx.shadowBlur  = 0;

        p.x += p.vx;
        p.y += p.vy;

        // Mouse repulsion
        if (mouse.on) {
          const md = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (md < 180) {
            const f = (180 - md) / 180;
            const a = Math.atan2(p.y - mouse.y, p.x - mouse.x);
            p.x += Math.cos(a) * f * 1.6;
            p.y += Math.sin(a) * f * 1.6;
          }
        }

        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove',  onMove);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize',     onRes);
    };
  }, []);

  // ── Template actions ──────────────────────────────────────────────────────
  const handleUseTemplate = async (template: SeedTemplate) => {
    await loadTemplateIntoIndexedDB(template);
    onEnterWorkspace(false);
  };

  const handlePreviewTemplate = (template: SeedTemplate) => {
    onEnterWorkspace(true, template);
  };

  const handleCreateBlank = async () => {
    await db.transaction('rw', [db.nodes, db.edges, db.images], async () => {
      await db.nodes.clear();
      await db.edges.clear();
      await db.images.clear();
      await db.nodes.add({
        id: `n_${Date.now()}`,
        type: 'INDIVIDUAL',
        name: 'Start Individual',
        sex: 'UNKNOWN',
        lifeStatus: 'ALIVE',
        traits: ['Founder'],
        x: 300,
        y: 250,
      });
    });
    onEnterWorkspace(false);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
          await db.transaction('rw', [db.nodes, db.edges, db.images], async () => {
            await db.nodes.clear();
            await db.edges.clear();
            await db.images.clear();
            await db.nodes.bulkAdd(data.nodes);
            await db.edges.bulkAdd(data.edges);
            if (Array.isArray(data.images)) await db.images.bulkAdd(data.images);
          });
          onEnterWorkspace(false);
        } else {
          setCustomAlert({ title: 'Invalid File Format', message: 'Invalid .ltree file format: missing nodes or edges.' });
        }
      } catch {
        setCustomAlert({ title: 'Import Failed', message: 'Failed to parse .ltree file.' });
      }
    };
    reader.readAsText(file);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="home-container">
      {/* Particle canvas background */}
      <canvas ref={canvasRef} className="canvas-bg" />

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="home-header">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="home-title-flex"
        >
          {Array.from('LineaTree').map((char, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, type: 'spring', stiffness: 80 }}
            >
              <span style={{ color: char === 'T' || char === 'L' ? '#61AFEF' : '#ABB2BF' }}>{char}</span>
            </motion.span>
          ))}
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.75 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="home-subtitle"
        >
          Zero-Database Pedigree &amp; Hybrid Social Mapper
        </motion.p>
      </header>

      {/* ── Snap Carousel ─────────────────────────────────────────────────── */}
      <div className="carousel-section">
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.85 }}
          transition={{ delay: 1 }}
          className="carousel-title"
        >
          Select a Template Sandbox
        </motion.h2>

        {/* Viewport + prev/next buttons */}
        <div className="carousel-viewport-wrapper">
          {/* Prev */}
          <button
            className="carousel-control prev"
            onClick={() => snapTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous template"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Overflow-hidden viewport */}
          <div ref={viewportRef} className="carousel-viewport">
            <motion.div
              drag="x"
              dragConstraints={getDragConstraints()}
              dragElastic={0.07}
              style={{ x }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              className={`carousel-track${isDragging ? ' is-dragging' : ''}`}
            >
              {TEMPLATES.map((tmpl, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <motion.div
                    key={tmpl.name}
                    className={`template-card${isActive ? ' card-active' : ''}`}
                    animate={{
                      scale:   isActive ? 1    : 0.90,
                      opacity: isActive ? 1    : 0.48,
                      y:       isActive ? -8   : 0,
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    onClick={() => { if (!isDraggingRef.current && !isActive) snapTo(idx); }}
                    style={{ cursor: isActive ? 'default' : 'pointer', userSelect: 'none' }}
                  >
                    {/* Active glow ring */}
                    {isActive && <div className="card-glow-ring" aria-hidden />}

                    <div>
                      {/* Index badge */}
                      <span className="card-badge">{idx + 1}&thinsp;/&thinsp;{TOTAL}</span>
                      <h3 className="card-title">{tmpl.name}</h3>
                      <p className="card-desc">{tmpl.description}</p>
                    </div>

                    <div className="card-actions">
                      <button
                        className="btn-preview"
                        tabIndex={isActive ? 0 : -1}
                        onClick={(e) => { e.stopPropagation(); handlePreviewTemplate(tmpl); }}
                      >
                        <PreviewIcon size={14} />
                        <span>Preview</span>
                      </button>
                      <button
                        className="btn-use"
                        tabIndex={isActive ? 0 : -1}
                        onClick={(e) => { e.stopPropagation(); handleUseTemplate(tmpl); }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#a6d488'; e.currentTarget.style.boxShadow = '0 0 12px rgba(152,195,121,0.4)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#98C379'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <span>Use Template</span>
                        <ArrowRightIcon size={14} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>

          {/* Next */}
          <button
            className="carousel-control next"
            onClick={() => snapTo(activeIndex + 1)}
            disabled={activeIndex === TOTAL - 1}
            aria-label="Next template"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Dot indicators */}
        <div className="carousel-indicators" role="tablist" aria-label="Template slides">
          {TEMPLATES.map((tmpl, idx) => (
            <button
              key={tmpl.name}
              role="tab"
              aria-selected={idx === activeIndex}
              aria-label={`Go to ${tmpl.name}`}
              className={`indicator-dot${idx === activeIndex ? ' active' : ''}`}
              onClick={() => snapTo(idx)}
            />
          ))}
        </div>

        {/* Active template name hint */}
        <AnimatePresence mode="wait">
          <motion.p
            key={activeIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 0.5, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="carousel-hint"
          >
            {TEMPLATES[activeIndex]?.name}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="home-footer">
        {isInstallable && (
          <button
            onClick={onInstallPWA}
            className="btn-blank"
            style={{ borderColor: 'rgba(97,175,239,0.25)', background: 'rgba(97,175,239,0.08)', color: '#61AFEF' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(97,175,239,0.15)'; e.currentTarget.style.borderColor = 'rgba(97,175,239,0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(97,175,239,0.08)'; e.currentTarget.style.borderColor = 'rgba(97,175,239,0.25)'; }}
          >
            <i className="fa-solid fa-mobile-screen-button" style={{ marginRight: '6px' }} />
            Install App
          </button>
        )}
        <button
          onClick={handleCreateBlank}
          className="btn-blank"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(152,195,121,0.15)'; e.currentTarget.style.borderColor = 'rgba(152,195,121,0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(152,195,121,0.08)'; e.currentTarget.style.borderColor = 'rgba(152,195,121,0.25)'; }}
        >
          <PlusIcon size={16} />
          <span>Create Blank Tree</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-import"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(171,178,191,0.15)'; e.currentTarget.style.borderColor = 'rgba(171,178,191,0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(171,178,191,0.08)'; e.currentTarget.style.borderColor = 'rgba(171,178,191,0.25)'; }}
        >
          <UploadIcon size={16} />
          <span>Import .ltree</span>
        </button>
        <input ref={fileInputRef} type="file" accept=".ltree" onChange={handleImportFile} style={{ display: 'none' }} />
      </footer>

      {/* ── Custom alert modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {customAlert && (
          <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="modal-content"
              style={{ maxWidth: '420px', border: '1px solid rgba(224,108,117,0.3)', boxShadow: '0 0 24px rgba(224,108,117,0.15)' }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: '#E06C75', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="fa-solid fa-triangle-exclamation" /> {customAlert.title}
                </h3>
                <button onClick={() => setCustomAlert(null)} className="modal-btn-close">×</button>
              </div>
              <div style={{ margin: '16px 0', fontSize: '13px', color: '#ABB2BF', lineHeight: 1.5 }}>
                {customAlert.message}
              </div>
              <div className="modal-actions" style={{ marginTop: '24px' }}>
                <button
                  onClick={() => setCustomAlert(null)}
                  className="btn-confirm"
                  style={{ background: '#E06C75', color: '#1E222B', fontWeight: 'bold', width: '100%', justifyContent: 'center' }}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
