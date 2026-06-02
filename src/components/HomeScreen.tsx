import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { TEMPLATES, loadTemplateIntoIndexedDB, type SeedTemplate } from '../db/seedData';
import { PreviewIcon, ArrowRightIcon, PlusIcon, UploadIcon } from './Icons';
import { db } from '../db/indexedDB';

interface HomeScreenProps {
  onEnterWorkspace: (readOnly: boolean, templateToPreview?: SeedTemplate) => void;
  isInstallable: boolean;
  onInstallPWA: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onEnterWorkspace, isInstallable, onInstallPWA }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Custom file input for .ltree
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Custom Alert Modal state
  const [customAlert, setCustomAlert] = useState<{ title: string; message: string } | null>(null);

  // Background Interactive Particle System
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
    }> = [];

    const colors = ['#61AFEF', '#98C379', '#C678DD', '#E5C07B', '#56B6C2'];
    const count = Math.min(65, Math.floor((width * height) / 16000));

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 3 + 2,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    let mouse = { x: -1000, y: -1000, active: false };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
      mouse.active = false;
    };

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResize);

    const draw = () => {
      ctx.fillStyle = '#282C34';
      ctx.fillRect(0, 0, width, height);

      // Draw Connections
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist < 135) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(171, 178, 191, ${0.15 * (1 - dist / 135)})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      // Draw and Move Particles
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        p.x += p.vx;
        p.y += p.vy;

        // Mouse interaction inertia
        if (mouse.active) {
          const mDist = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (mDist < 180) {
            const force = (180 - mDist) / 180;
            const angle = Math.atan2(p.y - mouse.y, p.x - mouse.x);
            p.x += Math.cos(angle) * force * 1.6;
            p.y += Math.sin(angle) * force * 1.6;
          }
        }

        // Bouncing
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

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

      const startId = `n_${Date.now()}`;
      await db.nodes.add({
        id: startId,
        type: 'INDIVIDUAL',
        name: 'Start Individual',
        sex: 'UNKNOWN',
        lifeStatus: 'ALIVE',
        traits: ['Founder'],
        x: 300,
        y: 250
      });
    });
    onEnterWorkspace(false);
  };

  // Import .ltree handler
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);
        if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
          await db.transaction('rw', [db.nodes, db.edges, db.images], async () => {
            await db.nodes.clear();
            await db.edges.clear();
            await db.images.clear();
            await db.nodes.bulkAdd(data.nodes);
            await db.edges.bulkAdd(data.edges);
            if (Array.isArray(data.images)) {
              await db.images.bulkAdd(data.images);
            }
          });
          onEnterWorkspace(false);
        } else {
          setCustomAlert({
            title: 'Invalid File Format',
            message: 'Invalid .ltree file format: missing nodes or edges data.'
          });
        }
      } catch (err) {
        setCustomAlert({
          title: 'Import Failed',
          message: 'Failed to parse .ltree file.'
        });
      }
    };
    reader.readAsText(file);
  };

  // Drag physics states
  const carouselDragX = useMotionValue(0);
  const cardRotation = useTransform(carouselDragX, [-300, 300], [-8, 8]);

  return (
    <div className="home-container">
      {/* Dynamic Network Canvas Background */}
      <canvas ref={canvasRef} className="canvas-bg" />

      {/* Top Section: Typographic Glow Header */}
      <header className="home-header">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="home-title-flex"
        >
          {Array.from("LineaTree").map((char, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, type: 'spring', stiffness: 80 }}
              style={{
                color: '#ABB2BF',
                textShadow: '0 0 16px rgba(97, 175, 239, 0.45)',
              }}
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
          Zero-Database Pedigree & Hybrid Social Mapper
        </motion.p>
      </header>

      {/* Middle Section: Swipable Glassmorphic Template Carousel */}
      <div className="carousel-section">
        <motion.h2 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.85 }}
          transition={{ delay: 1 }}
          className="carousel-title"
        >
          Select an Interactive Template Sandbox
        </motion.h2>

        <div ref={containerRef} className="carousel-viewport">
          <motion.div
            drag="x"
            dragConstraints={{ left: -180, right: 180 }}
            style={{ x: carouselDragX, rotateY: cardRotation }}
            className="carousel-track cursor-grab active:cursor-grabbing"
          >
            {TEMPLATES.map((tmpl) => (
              <motion.div
                key={tmpl.name}
                whileHover={{ scale: 1.025 }}
                className="template-card"
              >
                <div>
                  <h3 className="card-title">{tmpl.name}</h3>
                  <p className="card-desc">
                    {tmpl.description}
                  </p>
                </div>

                <div className="card-actions">
                  {/* Preview Sandbox */}
                  <button
                    onClick={() => handlePreviewTemplate(tmpl)}
                    className="btn-preview"
                  >
                    <PreviewIcon size={14} />
                    <span>Preview</span>
                  </button>

                  {/* Load Template */}
                  <button
                    onClick={() => handleUseTemplate(tmpl)}
                    className="btn-use"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#a6d488';
                      e.currentTarget.style.boxShadow = '0 0 12px rgba(152, 195, 121, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#98C379';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <span>Use Template</span>
                    <ArrowRightIcon size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Bottom Section: Primary Portals Entry */}
      <footer className="home-footer">
        {/* PWA Installer Trigger Button */}
        {isInstallable && (
          <button
            onClick={onInstallPWA}
            className="btn-blank"
            style={{
              borderColor: 'rgba(97, 175, 239, 0.25)',
              background: 'rgba(97, 175, 239, 0.08)',
              color: '#61AFEF'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(97, 175, 239, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(97, 175, 239, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(97, 175, 239, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(97, 175, 239, 0.25)';
            }}
          >
            <i className="fa-solid fa-mobile-screen-button" style={{ marginRight: '6px' }}></i> Install App
          </button>
        )}

        {/* Create Blank */}
        <button
          onClick={handleCreateBlank}
          className="btn-blank"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(152, 195, 121, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(152, 195, 121, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(152, 195, 121, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(152, 195, 121, 0.25)';
          }}
        >
          <PlusIcon size={16} />
          <span>Create Blank Tree</span>
        </button>

        {/* Import .ltree Archive */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-import"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(171, 178, 191, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(171, 178, 191, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(171, 178, 191, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(171, 178, 191, 0.25)';
          }}
        >
          <UploadIcon size={16} />
          <span>Import .ltree</span>
        </button>
        
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".ltree"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
      </footer>

      {/* Custom Glassmorphic Alert Modal */}
      <AnimatePresence>
        {customAlert && (
          <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="modal-content"
              style={{
                maxWidth: '420px',
                border: '1px solid rgba(224, 108, 117, 0.3)',
                boxShadow: '0 0 24px rgba(224, 108, 117, 0.15)'
              }}
            >
              <div className="modal-header">
                <h3 className="modal-title" style={{
                  color: '#E06C75',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> {customAlert.title}
                </h3>
                <button
                  onClick={() => setCustomAlert(null)}
                  className="modal-btn-close"
                >
                  ×
                </button>
              </div>

              <div style={{ margin: '16px 0', fontSize: '13px', color: '#ABB2BF', lineHeight: 1.5, textAlign: 'left' }}>
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
