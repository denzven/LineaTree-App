import type { PositionedNode } from './layoutEngine';
import type { TreeEdge } from '../db/indexedDB';

export type ExportTheme = 'ONE_DARK' | 'MEDICAL_HIGH_CONTEST' | 'HERITAGE_ARCHIVE';
export type ExportLayout = 'SINGLE_PAGE_BLUEPRINT' | 'MULTI_PAGE_A4_LEDGER';

interface ThemeTokens {
  bg: string;
  text: string;
  subtext: string;
  danger: string;
  success: string;
  warning: string;
  primary: string;
  secondary: string;
  alternative: string;
  nodeBorder: string;
  lineWeight: number;
}

const THEME_TOKENS: Record<ExportTheme, ThemeTokens> = {
  ONE_DARK: {
    bg: '#282C34',
    text: '#ABB2BF',
    subtext: '#5c6370',
    danger: '#E06C75',
    success: '#98C379',
    warning: '#E5C07B',
    primary: '#61AFEF',
    secondary: '#C678DD',
    alternative: '#56B6C2',
    nodeBorder: 'rgba(171, 178, 191, 0.4)',
    lineWeight: 2,
  },
  MEDICAL_HIGH_CONTEST: {
    bg: '#FFFFFF',
    text: '#000000',
    subtext: '#666666',
    danger: '#000000', // stark black lines
    success: '#000000',
    warning: '#000000',
    primary: '#000000',
    secondary: '#000000',
    alternative: '#000000',
    nodeBorder: '#000000',
    lineWeight: 3,
  },
  HERITAGE_ARCHIVE: {
    bg: '#FDFBF7', // warm cream
    text: '#1E2530', // deep historical navy
    subtext: '#505C70',
    danger: '#A63A50', // historical crimson
    success: '#3A7D44', // historical sage green
    warning: '#D4AF37', // gold-leaf
    primary: '#2D3A4F', // deep navy
    secondary: '#7A5B9B',
    alternative: '#439A86',
    nodeBorder: '#B89047', // gold leaf border outline
    lineWeight: 2.5,
  },
};

export function exportTreeToSvgString(
  nodes: PositionedNode[],
  edges: TreeEdge[],
  theme: ExportTheme,
  layout: ExportLayout
): string {
  const tokens = THEME_TOKENS[theme];

  // Calculate overall layout bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  nodes.forEach((n) => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });

  // Default fallback values if empty
  if (minX === Infinity) {
    minX = 100;
    maxX = 1100;
    minY = 100;
    maxY = 700;
  }

  // Padding
  const pad = 120;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const viewX = minX - pad;
  const viewY = minY - pad;

  let svgContent = '';

  // Setup Styles and Defs
  svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${width} ${height}" width="${width}" height="${height}" style="background-color: ${tokens.bg}; font-family: 'Inter', system-ui, sans-serif;">\n`;
  svgContent += `<defs>\n`;
  svgContent += `  <style>\n`;
  svgContent += `    .node-text { fill: ${tokens.text}; font-size: 14px; font-weight: 600; text-anchor: middle; }\n`;
  svgContent += `    .node-subtext { fill: ${tokens.subtext}; font-size: 11px; text-anchor: middle; }\n`;
  svgContent += `    .badge-text { font-size: 9px; font-weight: 800; text-anchor: middle; dominant-baseline: central; fill: ${theme === 'ONE_DARK' ? '#1E222B' : '#FFFFFF'}; }\n`;
  svgContent += `  </style>\n`;
  svgContent += `</defs>\n`;

  // Draw background layer (for PDF printing color loyalty)
  svgContent += `<rect x="${viewX}" y="${viewY}" width="${width}" height="${height}" fill="${tokens.bg}" />\n`;

  // 1. Draw Pedigree Marriage Spouses (Orthogonal Paths)
  const spouseEdges = edges.filter(
    (e) =>
      e.type === 'SPOUSE' ||
      e.type === 'CONSANGUINOUS' ||
      e.type === 'DIVORCED' ||
      e.type === 'FIANCE' ||
      e.type === 'SEPARATED' ||
      e.type === 'EX_PARTNER'
  );

  spouseEdges.forEach((edge) => {
    const sNode = nodes.find((n) => n.id === edge.source);
    const tNode = nodes.find((n) => n.id === edge.target);
    if (!sNode || !tNode) return;

    // Draw straight line along midpoints
    const yMid = (sNode.y + tNode.y) / 2;
    const xStart = Math.min(sNode.x, tNode.x);
    const xEnd = Math.max(sNode.x, tNode.x);

    let strokeColor = tokens.text;
    let strokeDash = 'none';
    let isDouble = false;
    let isDivorced = false;

    if (edge.type === 'CONSANGUINOUS') {
      strokeColor = tokens.warning;
      isDouble = true;
    } else if (edge.type === 'DIVORCED' || edge.type === 'EX_PARTNER') {
      strokeColor = tokens.danger;
      isDivorced = true;
    } else if (edge.type === 'FIANCE') {
      strokeColor = tokens.primary;
      strokeDash = '6,4';
    } else if (edge.type === 'SEPARATED') {
      strokeColor = tokens.danger;
      strokeDash = '4,4';
    }

    if (isDouble) {
      // Draw double parallel marriage lines
      svgContent += `  <line x1="${xStart}" y1="${yMid - 2}" x2="${xEnd}" y2="${yMid - 2}" stroke="${strokeColor}" stroke-width="${tokens.lineWeight}" />\n`;
      svgContent += `  <line x1="${xStart}" y1="${yMid + 2}" x2="${xEnd}" y2="${yMid + 2}" stroke="${strokeColor}" stroke-width="${tokens.lineWeight}" />\n`;
    } else {
      svgContent += `  <line x1="${xStart}" y1="${yMid}" x2="${xEnd}" y2="${yMid}" stroke="${strokeColor}" stroke-width="${tokens.lineWeight}" stroke-dasharray="${strokeDash}" />\n`;
    }

    if (isDivorced) {
      // Draw standard double slash cutting line
      const xMid = (xStart + xEnd) / 2;
      svgContent += `  <line x1="${xMid - 6}" y1="${yMid + 10}" x2="${xMid + 6}" y2="${yMid - 10}" stroke="${tokens.danger}" stroke-width="${tokens.lineWeight + 1}" />\n`;
      svgContent += `  <line x1="${xMid - 2}" y1="${yMid + 10}" x2="${xMid + 10}" y2="${yMid - 10}" stroke="${tokens.danger}" stroke-width="${tokens.lineWeight + 1}" />\n`;
    }
  });

  // 2. Draw Children Links (Biological / Adoptive / Foster drop downs)
  const childEdges = edges.filter(
    (e) =>
      e.type === 'BIOLOGICAL_PARENT' ||
      e.type === 'ADOPTIVE_PARENT' ||
      e.type === 'FOSTER_PARENT'
  );

  // Group child edges by source parent pair to make clean dropdown splits
  childEdges.forEach((edge) => {
    const parentNode = nodes.find((n) => n.id === edge.source);
    const childNode = nodes.find((n) => n.id === edge.target);
    if (!parentNode || !childNode) return;

    // Draw dropdown orthogonal line: drop from parent, route horizontally, then drop to child
    const midY = (parentNode.y + childNode.y) / 2;
    let strokeDash = 'none';
    let strokeColor = tokens.text;

    if (edge.type === 'ADOPTIVE_PARENT') {
      strokeDash = '5,5';
      strokeColor = tokens.alternative;
    } else if (edge.type === 'FOSTER_PARENT') {
      strokeDash = '2,3';
      strokeColor = tokens.warning;
    }

    // Step 1: drop from parent to mid Y
    svgContent += `  <path d="M ${parentNode.x} ${parentNode.y} L ${parentNode.x} ${midY} L ${childNode.x} ${midY} L ${childNode.x} ${childNode.y}" fill="none" stroke="${strokeColor}" stroke-width="${tokens.lineWeight}" stroke-dasharray="${strokeDash}" />\n`;
  });

  // 3. Draw Social Network Overlays (Cubic Bezier Elastic Arcs behind parents)
  const socialEdges = edges.filter(
    (e) =>
      e.type === 'FRIEND' ||
      e.type === 'BEST_FRIEND' ||
      e.type === 'NEIGHBOR' ||
      e.type === 'COWORKER' ||
      e.type === 'COLLEAGUE' ||
      e.type === 'CLASSMATE' ||
      e.type === 'ESTRANGED'
  );

  socialEdges.forEach((edge) => {
    const sNode = nodes.find((n) => n.id === edge.source);
    const tNode = nodes.find((n) => n.id === edge.target);
    if (!sNode || !tNode) return;

    const dx = tNode.x - sNode.x;
    const dy = tNode.y - sNode.y;
    // Cubic bezier control points running in arc above/below
    const offset = Math.min(180, Math.hypot(dx, dy) * 0.35);
    const cpx1 = sNode.x + dx * 0.25;
    const cpy1 = sNode.y + dy * 0.25 - offset;
    const cpx2 = sNode.x + dx * 0.75;
    const cpy2 = sNode.y + dy * 0.75 - offset;

    let strokeColor = tokens.success;
    let strokeDash = 'none';
    let isEst = false;
    let badgeText = '';

    if (edge.type === 'FRIEND' || edge.type === 'BEST_FRIEND') {
      strokeColor = tokens.success;
    } else if (edge.type === 'COWORKER' || edge.type === 'COLLEAGUE') {
      strokeColor = tokens.primary;
      strokeDash = '12,6';
      badgeText = 'W';
    } else if (edge.type === 'CLASSMATE') {
      strokeColor = tokens.secondary;
      strokeDash = '8,4,2,4';
      badgeText = 'U';
    } else if (edge.type === 'NEIGHBOR') {
      strokeColor = tokens.warning;
      strokeDash = '2,4';
      badgeText = 'N';
    } else if (edge.type === 'ESTRANGED') {
      strokeColor = tokens.danger;
      isEst = true;
    }

    if (isEst) {
      // Draw high-visibility zig-zag jagged path
      const steps = 14;
      let pathString = `M ${sNode.x} ${sNode.y}`;
      for (let i = 1; i <= steps; i++) {
        const ratio = i / steps;
        const baseX = sNode.x + dx * ratio;
        const baseY = sNode.y + dy * ratio;
        const perpX = -dy;
        const perpY = dx;
        const perpLen = Math.hypot(perpX, perpY);
        const amp = (i % 2 === 0 ? 12 : -12);
        const ox = (perpX / perpLen) * amp;
        const oy = (perpY / perpLen) * amp;
        pathString += ` L ${baseX + ox} ${baseY + oy}`;
      }
      svgContent += `  <path d="${pathString}" fill="none" stroke="${tokens.danger}" stroke-width="${tokens.lineWeight + 0.5}" />\n`;
    } else {
      // Draw Cubic Bezier
      svgContent += `  <path d="M ${sNode.x} ${sNode.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${tNode.x} ${tNode.y}" fill="none" stroke="${strokeColor}" stroke-width="${tokens.lineWeight - 0.5}" stroke-dasharray="${strokeDash}" />\n`;

      // Draw middle badge text
      if (badgeText) {
        // Find center of Bezier curve at t=0.5
        const t = 0.5;
        const midX = (1-t)**3 * sNode.x + 3*(1-t)**2*t * cpx1 + 3*(1-t)*t**2 * cpx2 + t**3 * tNode.x;
        const midY = (1-t)**3 * sNode.y + 3*(1-t)**2*t * cpy1 + 3*(1-t)*t**2 * cpy2 + t**3 * tNode.y;

        svgContent += `  <circle cx="${midX}" cy="${midY}" r="9" fill="${strokeColor}" />\n`;
        svgContent += `  <text x="${midX}" y="${midY}" class="badge-text">${badgeText}</text>\n`;
      }
    }
  });

  // 4. Draw Individual Geometric Nodes
  nodes.forEach((node) => {
    const size = 60;
    const half = size / 2;
    const x = node.x;
    const y = node.y;

    let fillHex = tokens.bg;
    // Map trait colors if any
    if (node.traits.includes('BRCA1 Carrier') || node.traits.includes('Hemophilia Carrier')) {
      fillHex = tokens.danger;
    } else if (node.traits.includes('Gout') || node.traits.includes('Hypertension')) {
      fillHex = tokens.warning;
    } else if (node.traits.length > 0) {
      fillHex = tokens.alternative;
    }

    svgContent += `  <!-- Node: ${node.name} -->\n`;
    svgContent += `  <g transform="translate(${x}, ${y})">\n`;

    // A. Primitive Shape
    if (node.sex === 'M') {
      // Square
      svgContent += `    <rect x="-${half}" y="-${half}" width="${size}" height="${size}" fill="${tokens.bg}" stroke="${tokens.nodeBorder}" stroke-width="2" rx="4" />\n`;
      if (fillHex !== tokens.bg) {
        svgContent += `    <rect x="-${half-4}" y="-${half-4}" width="${size-8}" height="${size-8}" fill="${fillHex}" opacity="0.3" rx="2" />\n`;
      }
    } else if (node.sex === 'F') {
      // Circle
      svgContent += `    <circle cx="0" cy="0" r="${half}" fill="${tokens.bg}" stroke="${tokens.nodeBorder}" stroke-width="2" />\n`;
      if (fillHex !== tokens.bg) {
        svgContent += `    <circle cx="0" cy="0" r="${half-4}" fill="${fillHex}" opacity="0.3" />\n`;
      }
    } else {
      // Diamond for Intersex or Unknown (rotated 45 deg rect)
      svgContent += `    <path d="M 0 -${half} L ${half} 0 L 0 ${half} L -${half} 0 Z" fill="${tokens.bg}" stroke="${tokens.nodeBorder}" stroke-width="2" />\n`;
      if (fillHex !== tokens.bg) {
        svgContent += `    <path d="M 0 -${half-5} L ${half-5} 0 L 0 ${half-5} L -${half-5} 0 Z" fill="${fillHex}" opacity="0.3" />\n`;
      }
    }

    // Deceased Indicator cross line
    if (node.lifeStatus === 'DECEASED') {
      svgContent += `    <line x1="-${half}" y1="${half}" x2="${half}" y2="-${half}" stroke="${tokens.danger}" stroke-width="2.5" />\n`;
    }

    // Primary Text (Legal Name)
    svgContent += `    <text x="0" y="${half + 18}" class="node-text">${node.name}</text>\n`;

    // Secondary Text (DoB / DoD or Age)
    let dateStr = node.dob ? node.dob.substring(0, 4) : '????';
    if (node.lifeStatus === 'DECEASED' && node.dod) {
      dateStr += ` - ${node.dod.substring(0, 4)}`;
    } else if (node.lifeStatus === 'DECEASED') {
      dateStr += ` - †`;
    } else if (node.dob) {
      // calculate age
      const age = new Date().getFullYear() - new Date(node.dob).getFullYear();
      dateStr = `${age} yrs`;
    }
    svgContent += `    <text x="0" y="${half + 32}" class="node-subtext">${dateStr}</text>\n`;

    svgContent += `  </g>\n`;
  });

  // 5. If layout mode is ledger, draw printable margins and registration tick marks
  if (layout === 'MULTI_PAGE_A4_LEDGER') {
    // Generate A4 aspect frames overlay (Grid of pages covering width/height)
    const pageW = 1200; // width of A4 portrait scale
    const pageH = 800; // height of A4 portrait scale
    const pagesX = Math.ceil(width / pageW);
    const pagesY = Math.ceil(height / pageH);

    for (let px = 0; px < pagesX; px++) {
      for (let py = 0; py < pagesY; py++) {
        const xMin = viewX + px * pageW;
        const yMin = viewY + py * pageH;

        // Draw page boundary border
        svgContent += `  <!-- Printable Page ${px+1}-${py+1} Frame -->\n`;
        svgContent += `  <rect x="${xMin + 5}" y="${yMin + 5}" width="${pageW - 10}" height="${pageH - 10}" fill="none" stroke="${tokens.subtext}" stroke-width="1.5" stroke-dasharray="8,8" opacity="0.4" />\n`;

        // Draw registration match mark crosshairs in corners
        const cornerOffset = 25;
        const corners = [
          [xMin + cornerOffset, yMin + cornerOffset],
          [xMin + pageW - cornerOffset, yMin + cornerOffset],
          [xMin + cornerOffset, yMin + pageH - cornerOffset],
          [xMin + pageW - cornerOffset, yMin + pageH - cornerOffset],
        ];

        corners.forEach(([cx, cy]) => {
          svgContent += `  <!-- Reg Mark -->\n`;
          svgContent += `  <circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${tokens.warning}" stroke-width="1" opacity="0.6" />\n`;
          svgContent += `  <line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="${tokens.warning}" stroke-width="1" opacity="0.6" />\n`;
          svgContent += `  <line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="${tokens.warning}" stroke-width="1" opacity="0.6" />\n`;
        });

        // Page Number Indicator label
        svgContent += `  <text x="${xMin + 40}" y="${yMin + pageH - 40}" fill="${tokens.warning}" font-size="12" opacity="0.75" font-weight="bold">LEDGER BAND PAGE ${px + 1}-${py + 1}</text>\n`;
      }
    }
  }

  svgContent += `</svg>`;
  return svgContent;
}

export function triggerDownload(content: string, filename: string, mimeType: string = 'image/svg+xml') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function triggerPrintWindow(svgString: string, theme: ExportTheme) {
  const tokens = THEME_TOKENS[theme];
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>LineaTree Blueprint Print Vector Export</title>
        <style>
          body {
            background-color: ${tokens.bg};
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: auto;
          }
          svg {
            max-width: 100%;
            height: auto;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          }
          @media print {
            body {
              background-color: #ffffff !important;
            }
            svg {
              box-shadow: none !important;
              max-width: 100% !important;
              page-break-inside: avoid;
            }
            @page {
              size: auto;
              margin: 0mm;
            }
          }
        </style>
      </head>
      <body>
        ${svgString}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
