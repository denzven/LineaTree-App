# 🧬 LineaTree — Zero-Database Pedigree & Deep Social Network Mapper

**LineaTree** is a progressive, high-performance, client-side progressive web application (PWA) designed for mapping complex genealogies, clinical pedigree cohorts, and hybrid social networks. By employing an offline-first architecture with zero external database dependencies, all data remains strictly private, secure, and portable.

---

## 🎨 Architectural Design Principles

1. **Zero-Database Delivery**: All persistent application state is managed directly within the user's browser using **IndexedDB** (via [Dexie.js](https://dexie.org/)). 
2. **Complete Data Portability**: Users can import and export their entire workspace, including downsampled compressed profile images, inside a single stringified JSON wrapper file (`.ltree`).
3. **High-Performance Rendering**: Utilizing interactive canvas layers combined with native SVG rendering, LineaTree smoothly supports multi-generational charts with custom zoom anchors, non-passive trackpad gesture preventions, and offline printing features.
4. **Military-Grade Visual Aesthetics**: Anchored in the popular **One Dark** color scheme, the interface leverages glassmorphism, glowing micro-animations, and responsive grids to deliver an premium, native-app feel on all devices.

---

## ✨ Advanced Features & Capabilities

### 📱 Full Device PWA Support
- **Adaptive Installers**: Native `beforeinstallprompt` event capturing provides one-click desktop/Android installation. For iOS Safari users, a glassmorphic step-by-step installation fallback is displayed automatically.
- **Apple iOS WebKit Integration**: Pre-rendered PNG touch icons (`apple-touch-icon.png`) and transparent status bar meta configurations ensure a native iOS appearance.
- **Safe-Area Notch Padding**: Uses CSS dynamic safe-insets (`env(safe-area-inset-top)`) to buffer top ribbons and sliders gracefully around physical device notches, status indicators, and cameras.
- **Robust Offline Precaching**: Integrated Workbox service workers cache all essential assets (JS, CSS, HTML, SVG symbols, and favicons), ensuring offline availability.

### 🖱️ Editor Interactions & Gestures
- **Coordinated Spousal Dragging**: Dragging any card automatically triggers a graph Breadth-First Search (BFS) solver. Any horizontally connected partners (spouses, fiances, ex-partners, divorced) translate rigidly in unison with a perfect 1:1 mouse/touch coordinate lock.
- **Canvas Zoom Anchors**: Trackpad pinches and wheel scrolls scale the SVG canvas smoothly from `15%` to `250%`, anchoring the zoom point directly under the user's cursor tip.
- **Blank Tree Starter Seeds**: Seeding a "Start Individual" root node automatically upon creating a blank workspace solves the typical usability deadlock of starting with an empty screen.
- **Custom Context Menus**: Intercepts native right-clicks to present glassmorphic options menus:
  - **Node Right Click**: Edit individual metadata, add spouse, add parents, add child (which automatically links biological parent lines to both the target node and their active spouse), connect social links, copy cards, and delete nodes.
  - **Canvas Right Click**: Add an independent individual (spawning them exactly where the cursor clicked in graph coordinates!), paste copied clipboard elements, reset viewport parameters, undo, and redo.
- **Accessible Action Toolbar**: Pins a touch-friendly console at the bottom-center of the screen with big, descriptive buttons that dynamically highlight or disable based on card selection states.

### ⌨️ Sandboxed Keyboard Shortcuts
- `Ctrl + Z` — **Active Undo**: Rewrites IndexedDB records in real-time to revert actions.
- `Ctrl + Y` (or `Ctrl + Shift + Z`) — **Active Redo**: Re-applies undone database states.
- `Ctrl + C` — **Copy Cards**: Clones selected cards and their internal links.
- `Ctrl + V` — **Paste Cards**: Duplicates cloned nodes, shifted by a `+80px` layout offset.
- `Ctrl + S` — **Save Workspace**: Downloads the active pedigree database as a secure, portable `.ltree` file.

### 📱 Mobile First UX
- **Long-Press Menu**: Long-pressing a card for `600ms` triggers the options context menu right under the touch point, with a `8px` drag jitter threshold to avoid menu popups during pans.
- **Swipe-to-Close Drawer**: Swiping right horizontally on the sliding Inspector drawer closes the panel instantly.

---

## 💾 IndexedDB Persistence Schema

All tables are optimized for query performance and relational synchronization:

```typescript
// db/indexedDB.ts
class LineaTreeDatabase extends Dexie {
  nodes!: Table<TreeNode, string>; // Individual details & screen coordinates
  edges!: Table<TreeEdge, string>; // Biological, legal, and social links
  images!: Table<ImageAsset, string>; // Base64 downsampled compressed avatars
}
```

---

## 🛠️ Getting Started & Commands

Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Local Development Server
Starts the local Vite dev server with Hot Module Replacement (HMR).
```bash
npm run dev
```

### 3. Compile Production Bundle
Compiles TypeScript modules, bundles files, and outputs highly optimized PWA assets under the `/dist` directory.
```bash
npm run build
```

### 4. Local Build Preview
Serves the local production build to simulate service workers and offline behaviors locally.
```bash
npm run preview
```

---

## 📂 Codebase Layout

```
familytreeapp/
├── public/                 # Static PWA assets, icons, and crawlers
│   ├── favicon.svg         # Premium vector logo
│   ├── apple-touch-icon.png# Pre-rendered iOS launch icon
│   ├── robots.txt          # Web crawler indexing configs
│   └── 404.html            # Static routing fallback page
├── src/
│   ├── assets/             # Global visual styling bundles
│   ├── components/
│   │   ├── HomeScreen.tsx  # Dynamic splash landing page
│   │   ├── Workspace.tsx   # SVG Interactive graph editor
│   │   └── Icons.tsx       # Custom UI symbols library
│   ├── db/
│   │   ├── indexedDB.ts    # Dexie schemas configurations
│   │   └── seedData.ts     # Pre-made sandbox templates
│   ├── utils/
│   │   ├── layoutEngine.ts # Pedigree generational layouts
│   │   └── exportPdf.ts    # SVG-to-Print window and PDFs
│   ├── App.tsx             # Entry, splash screen, and PWA logic
│   └── main.tsx            # Initial mounting point
├── package.json            # Scripts and dependencies declarations
└── vite.config.ts          # Vite bundling and Workbox generator configurations
```
