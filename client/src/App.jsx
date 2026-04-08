import { useState, useEffect, useRef } from "react";
import { auth, db, signInWithGoogle, logout } from "./firebase";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  EmailAuthProvider,
  linkWithCredential,
  updatePassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";

// =====================================================================
// FLOOR PLAN LAYOUT HELPERS (pure, framework-agnostic)
// =====================================================================
// Default dimensions (in feet) for common room types — used as fallback
// when the AI doesn't supply explicit width/height.
const ROOM_DEFAULTS = {
  "master bedroom": { w: 14, h: 13 },
  "bedroom":        { w: 12, h: 11 },
  "living":         { w: 18, h: 14 },
  "hall":           { w: 16, h: 12 },
  "family":         { w: 15, h: 13 },
  "kitchen":        { w: 12, h: 10 },
  "dining":         { w: 12, h: 10 },
  "bathroom":       { w: 8,  h: 6  },
  "bath":           { w: 8,  h: 6  },
  "toilet":         { w: 5,  h: 5  },
  "powder":         { w: 5,  h: 5  },
  "study":          { w: 10, h: 10 },
  "office":         { w: 11, h: 10 },
  "library":        { w: 11, h: 10 },
  "balcony":        { w: 10, h: 4  },
  "terrace":        { w: 12, h: 8  },
  "garage":         { w: 18, h: 12 },
  "parking":        { w: 18, h: 12 },
  "garden":         { w: 20, h: 12 },
  "foyer":          { w: 8,  h: 6  },
  "entry":          { w: 8,  h: 6  },
  "entrance":       { w: 8,  h: 6  },
  "laundry":        { w: 7,  h: 6  },
  "utility":        { w: 7,  h: 6  },
  "storage":        { w: 6,  h: 6  },
  "store":          { w: 6,  h: 6  },
  "closet":         { w: 6,  h: 5  },
  "walk-in":        { w: 8,  h: 6  },
  "pooja":          { w: 6,  h: 6  },
  "prayer":         { w: 6,  h: 6  },
  "guest":          { w: 12, h: 11 },
  "kids":           { w: 11, h: 10 },
  "gym":            { w: 12, h: 10 },
  "media":          { w: 14, h: 12 },
  "default":        { w: 11, h: 10 },
};

function defaultSizeFor(roomName) {
  const n = String(roomName || "").toLowerCase();
  for (const key of Object.keys(ROOM_DEFAULTS)) {
    if (key !== "default" && n.includes(key)) return ROOM_DEFAULTS[key];
  }
  return ROOM_DEFAULTS.default;
}

// Size hint for the UI: returns "≈ 14′ × 13′ · 182 sq.ft" + a comfort label
function sizeHintFor(roomName) {
  if (!roomName || !String(roomName).trim()) return null;
  const d = defaultSizeFor(roomName);
  const sqft = d.w * d.h;
  let comfort = "Standard";
  if (sqft < 60) comfort = "Compact";
  else if (sqft >= 180) comfort = "Spacious";
  return { w: d.w, h: d.h, sqft, comfort, text: `≈ ${d.w}′ × ${d.h}′ · ${sqft} sq.ft (${comfort})` };
}

// Shelf-packing algorithm — places rooms left-to-right in rows that wrap
// when they exceed the target plot width. Guarantees non-overlapping layout.
function packRooms(rawRooms, plotWidth) {
  const rooms = (rawRooms || []).map((r) => {
    if (typeof r === "string") {
      const d = defaultSizeFor(r);
      return { name: r, width: d.w, height: d.h };
    }
    const d = defaultSizeFor(r.name);
    return {
      name: r.name || "Room",
      width: Number(r.width) || d.w,
      height: Number(r.height) || d.h,
      x: r.x != null ? Number(r.x) : undefined,
      y: r.y != null ? Number(r.y) : undefined,
    };
  });

  // If AI already positioned every room, trust it and derive plot bounds
  if (rooms.length && rooms.every((r) => r.x != null && r.y != null)) {
    const maxX = Math.max(...rooms.map((r) => r.x + r.width));
    const maxY = Math.max(...rooms.map((r) => r.y + r.height));
    return { width: maxX, height: maxY, rooms };
  }

  // Otherwise, shelf-pack. Sort descending by height for better packing.
  const sorted = [...rooms].sort((a, b) => b.height - a.height);
  const PW = Math.max(plotWidth || 40, Math.max(...sorted.map((r) => r.width), 10));
  const placed = [];
  let cursorX = 0, cursorY = 0, rowH = 0;
  for (const r of sorted) {
    if (cursorX + r.width > PW) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    placed.push({ ...r, x: cursorX, y: cursorY });
    cursorX += r.width;
    rowH = Math.max(rowH, r.height);
  }
  return { width: PW, height: cursorY + rowH, rooms: placed };
}

// Normalize a floor received from the backend into the canonical shape
// { name, width, height, rooms: [{ name, x, y, width, height }] }.
// Accepts legacy string-only rooms AND fully-dimensioned rooms.
function normalizeFloor(floor, plotAreaSqft) {
  const roomsArr = floor?.rooms || [];
  const area = Number(plotAreaSqft) || 1500;
  const inferredPlotW = Math.round(Math.sqrt(area * 1.4)); // slightly wider than square
  const plotW = Number(floor?.width) || inferredPlotW;

  // Already fully laid out?
  if (
    floor?.width && floor?.height &&
    roomsArr.length &&
    roomsArr.every((r) => typeof r === "object" && r.x != null && r.y != null && r.width && r.height)
  ) {
    return {
      name: floor.name || "Floor",
      width: Number(floor.width),
      height: Number(floor.height),
      rooms: roomsArr.map((r) => ({
        name: r.name,
        x: Number(r.x),
        y: Number(r.y),
        width: Number(r.width),
        height: Number(r.height),
      })),
    };
  }

  const packed = packRooms(roomsArr, plotW);
  return { name: floor?.name || "Floor", ...packed };
}

function App() {
  const [user, setUser] = useState(null);
  // 'home' | 'login' | 'signup' | 'onboarding' | 'generator' | 'profile' | 'settings' | 'saved'
  const [page, setPage] = useState("home");
  const [saveCount, setSaveCount] = useState(0);

  // Firestore-backed user profile
  const [userProfile, setUserProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Forced password setup (for Google users who don't have a password yet)
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);

  // Header user menu (dropdown)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Auth form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Dark mode — default to system preference
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  // Onboarding / Layout preferences
  const [houseType, setHouseType] = useState("");
  const [style, setStyle] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [budget, setBudget] = useState("");
  const [onboardingDone, setOnboardingDone] = useState(false);

  // Conditional detail fields (populated based on house type)
  const [floors, setFloors] = useState("");
  const [plotArea, setPlotArea] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [carpetArea, setCarpetArea] = useState("");
  const [hasBalcony, setHasBalcony] = useState("");
  const [hasGarden, setHasGarden] = useState("");
  const [hasParking, setHasParking] = useState("");

  // Extra prefs
  const [description, setDescription] = useState("");
  const [blueprintFile, setBlueprintFile] = useState(null);

  // Generator — multi-floor plan returned by the backend
  // Shape: [{ name: string, rooms: string[] }, ...]
  const [generatedFloors, setGeneratedFloors] = useState([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [savedDesigns, setSavedDesigns] = useState([]);

  // User-specified room sizes (optional). Each: { name, width, height }
  // If provided, the AI is told to use these EXACT dimensions.
  const [customRooms, setCustomRooms] = useState([
    { name: "Living Room", width: "18", height: "14" },
    { name: "Kitchen",     width: "12", height: "10" },
  ]);

  // AI-generated image of the layout (free, via Pollinations.ai)
  const [aiImageUrl, setAiImageUrl] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);

  const addCustomRoom = () =>
    setCustomRooms((rs) => [...rs, { name: "", width: "", height: "" }]);
  const removeCustomRoom = (idx) =>
    setCustomRooms((rs) => rs.filter((_, i) => i !== idx));
  const updateCustomRoom = (idx, field, value) =>
    setCustomRooms((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );

  // Apply the suggested size to a single row (uses the room's name)
  const applySuggestedSize = (idx) =>
    setCustomRooms((rs) =>
      rs.map((r, i) => {
        if (i !== idx) return r;
        const d = defaultSizeFor(r.name || "room");
        return { ...r, width: String(d.w), height: String(d.h) };
      })
    );

  // Fill EVERY empty size field with the suggested default
  const fillAllSuggested = () =>
    setCustomRooms((rs) =>
      rs.map((r) => {
        if (r.width && r.height) return r;
        const d = defaultSizeFor(r.name || "room");
        return {
          ...r,
          width: r.width || String(d.w),
          height: r.height || String(d.h),
        };
      })
    );

  // Auto-sync bedrooms count → ensure exactly N "Bedroom" rows exist in
  // customRooms. Preserves any sizes the user already entered for those rooms.
  useEffect(() => {
    const n = parseInt(bedrooms, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) return;
    setCustomRooms((rs) => {
      const nonBed = rs.filter((r) => !/bedroom/i.test(r.name || ""));
      const existingBeds = rs.filter((r) => /bedroom/i.test(r.name || ""));
      const newBeds = [];
      for (let i = 0; i < n; i++) {
        const label = i === 0 ? "Master Bedroom" : `Bedroom ${i + 1}`;
        const prev =
          existingBeds.find((b) => b.name.toLowerCase() === label.toLowerCase()) ||
          existingBeds[i];
        if (prev) {
          newBeds.push({ ...prev, name: label });
        } else {
          const d = defaultSizeFor(label);
          newBeds.push({ name: label, width: String(d.w), height: String(d.h) });
        }
      }
      return [...nonBed, ...newBeds];
    });
  }, [bedrooms]);

  // Load a saved design back into the studio (clicked from Saved page or profile)
  const loadSavedDesign = (d) => {
    if (!d) return;
    if (d.houseType) setHouseType(d.houseType);
    if (d.style)     setStyle(d.style);
    if (d.bedrooms)  setBedrooms(String(d.bedrooms));
    if (d.budget)    setBudget(d.budget);
    // Restore the dimensioned floors directly
    if (d.floors && d.floors.length) {
      const normalized = d.floors.map((f) => normalizeFloor(f, 1500));
      setGeneratedFloors(normalized);
    }
    if (d.suggestion) setSuggestion(d.suggestion);
    if (d.aiImageUrl) setAiImageUrl(d.aiImageUrl);
    // Restore custom-room sizes (so the user can keep editing)
    if (d.customRooms && d.customRooms.length) {
      setCustomRooms(d.customRooms);
    } else if (d.floors && d.floors[0]?.rooms) {
      // Legacy: derive editable rows from the first floor
      setCustomRooms(
        d.floors[0].rooms.map((r) => ({
          name: r.name || "Room",
          width: String(r.width || ""),
          height: String(r.height || ""),
        }))
      );
    }
    setPage("generator");
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Load or create Firestore profile
        setProfileLoading(true);
        try {
          const userRef = doc(db, "users", currentUser.uid);
          const snap = await getDoc(userRef);
          let profile;
          if (!snap.exists()) {
            profile = {
              email: currentUser.email || "",
              displayName: currentUser.displayName || "",
              createdAt: serverTimestamp(),
              hasPasswordSet: currentUser.providerData.some(
                (p) => p.providerId === "password"
              ),
              savedPlans: [],
              preferences: {},
            };
            await setDoc(userRef, profile);
          } else {
            profile = snap.data();
          }
          setUserProfile(profile);
          // Hydrate saved designs from Firestore
          if (Array.isArray(profile.savedPlans)) {
            setSavedDesigns(profile.savedPlans);
            setSaveCount(profile.savedPlans.length);
          }
          // Hydrate preferences if present
          if (profile.preferences && Object.keys(profile.preferences).length) {
            const p = profile.preferences;
            if (p.houseType) setHouseType(p.houseType);
            if (p.style) setStyle(p.style);
            if (p.bedrooms) setBedrooms(p.bedrooms);
            if (p.budget) setBudget(p.budget);
            if (p.houseType && p.style) setOnboardingDone(true);
          }

          // Check if Google-auth user needs to set a password
          const hasPasswordProvider = currentUser.providerData.some(
            (p) => p.providerId === "password"
          );
          if (!hasPasswordProvider && !profile.hasPasswordSet) {
            setShowPasswordSetup(true);
          }
        } catch (err) {
          console.error("Failed to load user profile:", err);
        } finally {
          setProfileLoading(false);
        }

        setPage((prev) =>
          prev === "home" || prev === "login" || prev === "signup"
            ? onboardingDone
              ? "generator"
              : "onboarding"
            : prev
        );
      } else {
        setPage("home");
        setGeneratedFloors([]);
        setLoadingPlan(false);
        setSuggestion("");
        setUserProfile(null);
        setSavedDesigns([]);
        setSaveCount(0);
        setShowPasswordSetup(false);
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line
  }, []);

  // Listen to system dark mode changes
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = (e) => setDarkMode(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      // ignore
    }
    setPage("home");
    setUserMenuOpen(false);
  };

  // Close user menu when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Link a password credential onto a Google-signed-in account
  const handlePasswordSetup = async () => {
    setSetupError("");
    if (setupPassword.length < 6)
      return setSetupError("Password must be at least 6 characters.");
    if (setupPassword !== setupConfirm)
      return setSetupError("Passwords do not match.");
    if (!auth.currentUser) return setSetupError("No user signed in.");
    try {
      setSetupLoading(true);
      const credential = EmailAuthProvider.credential(
        auth.currentUser.email,
        setupPassword
      );
      try {
        await linkWithCredential(auth.currentUser, credential);
      } catch (linkErr) {
        // If already linked (e.g. retry), fall back to updatePassword
        if (linkErr.code === "auth/provider-already-linked") {
          await updatePassword(auth.currentUser, setupPassword);
        } else {
          throw linkErr;
        }
      }
      // Mark in Firestore
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, { hasPasswordSet: true });
      setUserProfile((prev) => (prev ? { ...prev, hasPasswordSet: true } : prev));
      setShowPasswordSetup(false);
      setSetupPassword("");
      setSetupConfirm("");
    } catch (err) {
      setSetupError(err.message || "Failed to set password.");
    } finally {
      setSetupLoading(false);
    }
  };

  // ---------- INJECT GLOBAL STYLES ----------
  useEffect(() => {
    if (document.getElementById("planora-global-styles")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "planora-global-styles";
    styleEl.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@300;400;500;600;700&display=swap');

      * { box-sizing: border-box; }
      html, body, #root { margin: 0; padding: 0; width: 100%; }
      html { scroll-behavior: smooth; }

      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideInLeft {
        from { opacity: 0; transform: translateX(-30px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(30px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes scaleIn {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-12px); }
      }
      @keyframes drawLine {
        from { stroke-dashoffset: 1000; }
        to { stroke-dashoffset: 0; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.05); }
      }
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes rotateSlow {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes marquee {
        from { transform: translateX(0); }
        to { transform: translateX(-50%); }
      }
      @keyframes glassSlideDown {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .anim-fadeUp { animation: fadeUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-fadeIn { animation: fadeIn 1s ease-out both; }
      .anim-slideLeft { animation: slideInLeft 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-slideRight { animation: slideInRight 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-scaleIn { animation: scaleIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-float { animation: float 6s ease-in-out infinite; }
      .anim-glassSlide { animation: glassSlideDown 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }

      .planora-btn {
        transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease, background 0.25s ease;
      }
      .planora-btn:hover { transform: translateY(-2px); }
      .planora-btn:active { transform: translateY(0); }

      .planora-card {
        transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s ease, border-color 0.25s ease;
      }
      .planora-card:hover { transform: translateY(-6px); }

      /* Glass card — stronger glassmorphism */
      .glass-card {
        backdrop-filter: blur(28px) saturate(200%);
        -webkit-backdrop-filter: blur(28px) saturate(200%);
        transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s ease, background 0.25s ease;
        position: relative;
        isolation: isolate;
      }
      .glass-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background:
          linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 60%),
          radial-gradient(circle at 100% 0%, rgba(255,255,255,0.12) 0%, transparent 50%);
        mix-blend-mode: overlay;
        z-index: -1;
      }
      .glass-card::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.18), inset 0 -1px 0 0 rgba(0,0,0,0.04);
      }
      .glass-card:hover { transform: translateY(-4px); }

      .planora-link {
        position: relative;
        transition: color 0.2s ease;
      }
      .planora-link::after {
        content: '';
        position: absolute;
        left: 0; bottom: -2px;
        width: 100%; height: 1px;
        background: currentColor;
        transform: scaleX(0);
        transform-origin: right;
        transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .planora-link:hover::after {
        transform: scaleX(1);
        transform-origin: left;
      }

      .planora-input {
        transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }
      .planora-input:focus {
        border-color: #c8553d !important;
        box-shadow: 0 0 0 4px rgba(200, 85, 61, 0.12);
        outline: none;
      }

      .floor-line {
        stroke-dasharray: 1000;
        stroke-dashoffset: 1000;
        animation: drawLine 2.5s ease-out forwards;
      }

      .marquee-track {
        display: flex;
        width: max-content;
        animation: marquee 40s linear infinite;
      }

      .shimmer-text {
        background: linear-gradient(90deg, var(--shimmer-base, #14110f) 0%, #c8553d 50%, var(--shimmer-base, #14110f) 100%);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: shimmer 4s linear infinite;
      }

      .grain::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.04;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      @media (max-width: 900px) {
        .two-col { grid-template-columns: 1fr !important; }
        .hero-title { font-size: 3rem !important; }
        .big-pad { padding: 24px !important; }
      }

      .scroll-reveal {
        opacity: 0;
        transform: translateY(40px);
        transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity, transform;
      }
      .scroll-reveal.revealed { opacity: 1; transform: translateY(0); }
      .scroll-reveal-left {
        opacity: 0;
        transform: translateX(-40px);
        transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .scroll-reveal-left.revealed { opacity: 1; transform: translateX(0); }
      .scroll-reveal-right {
        opacity: 0;
        transform: translateX(40px);
        transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .scroll-reveal-right.revealed { opacity: 1; transform: translateX(0); }
      .scroll-reveal-scale {
        opacity: 0;
        transform: scale(0.92);
        transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .scroll-reveal-scale.revealed { opacity: 1; transform: scale(1); }
    `;
    document.head.appendChild(styleEl);
  }, []);

  const fontDisplay = "'Fraunces', Georgia, serif";
  const fontBody = "'Inter', -apple-system, Segoe UI, sans-serif";

  // ---------- SCROLL REVEAL OBSERVER ----------
  useEffect(() => {
    if (page !== "home") return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    const t = setTimeout(() => {
      document
        .querySelectorAll(".scroll-reveal, .scroll-reveal-left, .scroll-reveal-right, .scroll-reveal-scale")
        .forEach((el) => {
          if (!el.classList.contains("revealed")) observer.observe(el);
        });
    }, 50);
    return () => { clearTimeout(t); observer.disconnect(); };
  }, [page]);

  // ---------- SYNC DARK MODE CSS VARS ----------
  useEffect(() => {
    document.documentElement.style.setProperty("--shimmer-base", darkMode ? "#f5efe4" : "#1a1613");
    document.body.style.background = darkMode ? "#0a0908" : "#f2ede2";
    document.body.style.color = darkMode ? "#f5efe4" : "#1a1613";
  }, [darkMode]);

  // ---------- THEME ----------
  const theme = darkMode
    ? {
        // backgrounds — better separation between layers
        cream: "#0a0908",
        ivory: "#15120f",
        // glassmorphism — stronger, more readable
        card: "rgba(255,255,255,0.07)",
        cardSolid: "#1e1a16",
        glass: "rgba(255,255,255,0.09)",
        glassBorder: "rgba(255,255,255,0.16)",
        glassHover: "rgba(255,255,255,0.14)",
        glassBlur: "blur(28px) saturate(180%)",
        // typography — softer ink, clearer muted
        ink: "#f5efe4",
        muted: "#a89e91",
        // accents — slightly warmer so they pop on dark glass
        forest: "#6ba07f",
        forestDeep: "#42735a",
        terracotta: "#ea7a60",
        gold: "#ebbd39",
        plum: "#8a5a73",
        sand: "#2a2520",
        line: "rgba(255,255,255,0.12)",
      }
    : {
        cream: "#f2ede2",
        ivory: "#fbf7ee",
        card: "rgba(255,255,255,0.6)",
        cardSolid: "#ffffff",
        glass: "rgba(255,255,255,0.45)",
        glassBorder: "rgba(255,255,255,0.75)",
        glassHover: "rgba(255,255,255,0.75)",
        glassBlur: "blur(28px) saturate(180%)",
        ink: "#1a1613",
        muted: "#736c60",
        forest: "#1f4735",
        forestDeep: "#123024",
        terracotta: "#c8553d",
        gold: "#d4a017",
        plum: "#4a2c3e",
        sand: "#e8dfd0",
        line: "rgba(20,17,15,0.12)",
      };

  // ---------- AUTH HANDLERS ----------
  const handleSignUp = async () => {
    setAuthError("");
    if (!name.trim()) return setAuthError("Please enter your name.");
    if (!email.trim()) return setAuthError("Please enter your email.");
    if (password.length < 6) return setAuthError("Password must be at least 6 characters.");
    if (password !== confirmPassword) return setAuthError("Passwords do not match.");
    try {
      setAuthLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (cred.user) await updateProfile(cred.user, { displayName: name });
      setPage("onboarding");
    } catch (err) {
      setAuthError(err.message || "Sign up failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailLogin = async () => {
    setAuthError("");
    if (!email || !password) return setAuthError("Enter email and password.");
    try {
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      setPage(onboardingDone ? "generator" : "onboarding");
    } catch (err) {
      setAuthError(err.message || "Login failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const saveDesign = async () => {
    if (generatedFloors.length === 0) { alert("Generate a design first!"); return; }
    // Derive a flat rooms list for backward compat with profile/saved pages.
    // Rooms may be strings (legacy) or objects {name,x,y,width,height} (new).
    const flatRooms = generatedFloors.flatMap((f) =>
      (f.rooms || []).map((r) => (typeof r === "string" ? r : r.name))
    );
    const newDesign = {
      id: Date.now(),
      name: `${style || "Custom"} ${houseType || "home"} #${savedDesigns.length + 1}`,
      houseType, style, bedrooms, budget,
      rooms: flatRooms,
      // Preserve full dimensioned floors so saved plans can re-render the SVG
      floors: generatedFloors.map((f) => ({
        name: f.name,
        width: f.width,
        height: f.height,
        rooms: (f.rooms || []).map((r) =>
          typeof r === "string"
            ? { name: r }
            : { name: r.name, x: r.x, y: r.y, width: r.width, height: r.height }
        ),
      })),
      // Editable room-size rows so the user can re-tweak after re-opening
      customRooms,
      // AI image URL so it appears immediately when re-opened
      aiImageUrl,
      suggestion,
      savedAt: new Date().toLocaleDateString(),
    };
    setSavedDesigns((prev) => [newDesign, ...prev]);
    setSaveCount((c) => c + 1);

    // Persist to Firestore
    if (user) {
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          savedPlans: arrayUnion(newDesign),
          preferences: { houseType, style, bedrooms, budget },
        });
      } catch (err) {
        console.error("Failed to save design to Firestore:", err);
      }
    }
  };

  // ---------- GENERATE FLOOR PLAN (backend AI) ----------
  /**
   * Expected backend response shape (each floor object):
   * {
   *   floors: [
   *     {
   *       name: "Ground Floor",
   *       width: 40,          // overall usable plot width in feet
   *       height: 30,         // overall usable plot height in feet
   *       rooms: [
   *         { name: "Living Room", x: 0,  y: 0,  width: 18, height: 14 },
   *         { name: "Kitchen",     x: 18, y: 0,  width: 12, height: 10 },
   *         { name: "Bedroom 1",   x: 0,  y: 14, width: 14, height: 13 },
   *         ...
   *       ]
   *     }
   *   ],
   *   suggestion: "optional string"
   * }
   *
   * Suggested system prompt for your backend (Claude / OpenAI / etc):
   * "You are an architect AI. Given user preferences, output strict JSON
   *  with a `floors` array. Each floor has { name, width, height, rooms }.
   *  Every room has { name, x, y, width, height } in FEET. Rooms must NOT
   *  overlap and must fit within (width × height). Place x,y from top-left
   *  corner (0,0). Return ONLY JSON — no markdown, no prose."
   *
   * If the backend returns only room NAMES (legacy shape), the client will
   * auto-size and pack them using normalizeFloor() — so the UI still works.
   */
  // ----- Free AI helpers (Pollinations.ai — no key, no backend) -----
  // Text:  https://text.pollinations.ai/openai  (OpenAI chat-completions compatible, free)
  // Image: https://image.pollinations.ai/prompt/<prompt>  (free, direct URL)
  const callPollinationsText = async (systemPrompt, userPrompt) => {
    // Try the OpenAI-compatible endpoint first (most reliable)
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          seed: Math.floor(Math.random() * 1_000_000),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content =
          data?.choices?.[0]?.message?.content ??
          (typeof data === "string" ? data : "");
        if (content) return content;
      }
    } catch (e) {
      console.warn("openai endpoint failed, falling back:", e);
    }

    // Fallback: simple POST to the root text endpoint
    const res2 = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        model: "openai",
        jsonMode: true,
      }),
    });
    if (!res2.ok) throw new Error(`Pollinations text error ${res2.status}`);
    return await res2.text();
  };

  // Local fallback: build a floor plan directly from the user's room sizes
  // (or sensible defaults) using the existing packRooms() algorithm.
  // This guarantees the user always gets a plan even if the AI is down.
  const buildLocalFloorPlan = (validCustomRooms, areaHint) => {
    let rooms = validCustomRooms;
    if (rooms.length === 0) {
      // No custom rooms — synthesize a sensible default set
      const bedroomCount = Math.max(1, parseInt(bedrooms || "3", 10));
      rooms = [
        { name: "Living Room", width: 18, height: 14 },
        { name: "Kitchen",     width: 12, height: 10 },
        { name: "Dining",      width: 12, height: 10 },
        ...Array.from({ length: bedroomCount }, (_, i) => ({
          name: i === 0 ? "Master Bedroom" : `Bedroom ${i + 1}`,
          width: i === 0 ? 14 : 12,
          height: i === 0 ? 13 : 11,
        })),
        { name: "Bathroom", width: 8, height: 6 },
      ];
    }
    const inferredPlotW = Math.round(Math.sqrt(areaHint * 1.4));
    const packed = packRooms(rooms, inferredPlotW);
    return {
      floors: [{ name: "Ground Floor", ...packed }],
      suggestion: `Local layout built from ${rooms.length} room${rooms.length > 1 ? "s" : ""} (AI text service unavailable, but the AI image was still generated).`,
    };
  };

  const buildImagePrompt = (floors) => {
    const roomList = floors
      .flatMap((f) => (f.rooms || []).map((r) => r.name))
      .slice(0, 12)
      .join(", ");
    return (
      `top-down architectural floor plan blueprint of a ${style} ${houseType}, ` +
      `${bedrooms || "3"} bedrooms, rooms include: ${roomList}, ` +
      `clean lines, labeled rooms, pastel colors, soft shadows, ` +
      `professional architect drawing, high detail, isometric perspective hint`
    );
  };

  const generateFloorPlan = async () => {
    if (!houseType || !style) {
      alert("Please complete onboarding first — select a house type and style.");
      setPage("onboarding");
      return;
    }
    try {
      setLoadingPlan(true);
      setGeneratedFloors([]);
      setSuggestion("");
      setAiImageUrl("");

      // Filter user-supplied custom room sizes (only valid rows)
      const validCustomRooms = customRooms
        .filter((r) => r.name && Number(r.width) > 0 && Number(r.height) > 0)
        .map((r) => ({
          name: r.name.trim(),
          width: Number(r.width),
          height: Number(r.height),
        }));

      const areaHint = Number(plotArea) || Number(carpetArea) || 1500;

      const systemPrompt =
        "You are an expert architect AI. Output STRICT JSON ONLY — no markdown, no prose. " +
        "Schema: { \"floors\": [ { \"name\": string, \"width\": number, \"height\": number, " +
        "\"rooms\": [ { \"name\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number } ] } ], " +
        "\"suggestion\": string }. " +
        "All dimensions are in FEET. Place rooms from top-left (0,0). Rooms MUST NOT overlap and MUST fit within the floor's width × height. " +
        "If the user provides exact room sizes, you MUST use those EXACT width and height values for those rooms.";

      const userPrompt = JSON.stringify({
        houseType,
        style,
        bedrooms: bedrooms || "3",
        budget: budget || "",
        description: description || "",
        floors: floors || "1",
        plotArea: plotArea || "",
        floorNumber: floorNumber || "",
        carpetArea: carpetArea || "",
        hasBalcony, hasGarden, hasParking,
        totalAreaSqft: areaHint,
        userSpecifiedRoomSizes: validCustomRooms,
        instructions:
          validCustomRooms.length > 0
            ? "Use the EXACT dimensions in userSpecifiedRoomSizes for those rooms. Add other rooms as needed for a complete plan."
            : "Generate a complete, realistic layout with sensible room sizes.",
      });

      // Kick off image generation in parallel — Pollinations returns a real
      // image when you simply GET the URL, so we just set the src.
      setLoadingImage(true);

      // Try AI text generation; on ANY failure, fall back to a locally-built
      // plan so the user is never blocked.
      let parsed = null;
      try {
        const raw = await callPollinationsText(systemPrompt, userPrompt);
        console.log("AI raw:", raw);
        const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
      } catch (aiErr) {
        console.warn("AI text generation failed:", aiErr);
      }

      if (!parsed || !parsed.floors || parsed.floors.length === 0) {
        console.warn("Using local fallback floor plan");
        parsed = buildLocalFloorPlan(validCustomRooms, areaHint);
      }

      const normalized = parsed.floors.map((f) => normalizeFloor(f, areaHint));
      setGeneratedFloors(normalized);

      const totalRooms = normalized.reduce((acc, f) => acc + (f.rooms?.length || 0), 0);
      const totalArea = normalized.reduce((acc, f) => acc + Math.round(f.width * f.height), 0);
      setSuggestion(
        parsed.suggestion ||
        `${style} ${houseType} with ${normalized.length} floor(s), ${totalRooms} rooms, approx ${totalArea} sq.ft total. Tailored for ${bedrooms || "3"} bedrooms.`
      );

      // Always request the AI image (free, no key). The browser loads it directly.
      const imgPrompt = buildImagePrompt(normalized);
      const seed = Math.floor(Math.random() * 1_000_000);
      const url =
        "https://image.pollinations.ai/prompt/" +
        encodeURIComponent(imgPrompt) +
        `?width=1024&height=768&nologo=true&seed=${seed}`;
      setAiImageUrl(url);
    } catch (err) {
      console.error("Generate error:", err);
      alert("Failed to generate plan: " + err.message);
    } finally {
      setLoadingPlan(false);
    }
  };

  // ---------- SHARED STYLES ----------
  const inputStyle = {
    width: "100%",
    padding: "14px 16px",
    marginTop: "6px",
    marginBottom: "16px",
    background: darkMode ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: `1px solid ${theme.glassBorder}`,
    borderRadius: "10px",
    fontSize: "0.95rem",
    outline: "none",
    boxSizing: "border-box",
    color: theme.ink,
  };

  const labelStyle = {
    fontSize: "0.75rem",
    color: theme.muted,
    fontWeight: 600,
    letterSpacing: "0.6px",
  };

  // Glass card style helper
  const glassCard = (extra = {}) => ({
    background: theme.card,
    backdropFilter: theme.glassBlur,
    WebkitBackdropFilter: theme.glassBlur,
    border: `1px solid ${theme.glassBorder}`,
    boxShadow: darkMode
      ? "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)"
      : "0 8px 32px rgba(20,17,15,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
    ...extra,
  });

  // ---------- FULL-WIDTH GLASS HEADER (post-login pages) ----------
  const AppHeader = ({ subtitle, extraActions }) => (
    <header
      className="anim-glassSlide"
      style={{
        position: "sticky",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
        margin: 0,
        zIndex: 200,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0 48px",
        height: "68px",
        background: darkMode
          ? "rgba(10,9,8,0.72)"
          : "rgba(242,237,226,0.72)",
        backdropFilter: "blur(28px) saturate(200%)",
        WebkitBackdropFilter: "blur(28px) saturate(200%)",
        borderBottom: `1px solid ${theme.glassBorder}`,
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <svg width="28" height="28" viewBox="0 0 40 40">
          <rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" />
          <line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" />
          <line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" />
          <circle cx="30" cy="12" r="3" fill={theme.terracotta} />
        </svg>
        <span style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.5px", fontFamily: fontDisplay, color: theme.ink }}>
          Planora
          {subtitle && (
            <em style={{ fontWeight: 400, fontStyle: "italic", color: theme.muted, fontSize: "1rem", marginLeft: "6px" }}>
              · {subtitle}
            </em>
          )}
        </span>
      </div>

      {/* Right side controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {extraActions}

        {/* Dark mode toggle */}
        <button
          className="planora-btn"
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            width: "38px", height: "38px",
            borderRadius: "50%",
            background: theme.glass,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: `1px solid ${theme.glassBorder}`,
            cursor: "pointer",
            fontSize: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: darkMode ? theme.gold : theme.forest,
          }}
        >
          {darkMode ? "☀" : "☾"}
        </button>

        {/* User menu */}
        <div ref={userMenuRef} style={{ position: "relative" }}>
          <button
            className="planora-btn"
            onClick={() => setUserMenuOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "6px 14px 6px 6px",
              borderRadius: "999px",
              cursor: "pointer",
              background: theme.glass,
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: `1px solid ${theme.glassBorder}`,
              color: theme.ink,
              fontFamily: fontBody,
              fontSize: "0.85rem",
            }}
          >
            <span
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`,
                color: "#faf5ec",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: "0.82rem",
                fontFamily: fontDisplay,
              }}
            >
              {(user?.displayName || user?.email || "U").trim()[0].toUpperCase()}
            </span>
            <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: theme.ink }}>
              {user?.displayName || user?.email?.split("@")[0]}
            </span>
            <span style={{ color: theme.muted, fontSize: "0.7rem" }}>▾</span>
          </button>

          {userMenuOpen && (
            <div
              className="glass-card anim-glassSlide"
              style={{
                position: "absolute",
                top: "calc(100% + 10px)",
                right: 0,
                minWidth: "220px",
                padding: "8px",
                borderRadius: "14px",
                background: darkMode ? "rgba(20,17,15,0.85)" : "rgba(255,250,241,0.85)",
                border: `1px solid ${theme.glassBorder}`,
                boxShadow: darkMode
                  ? "0 20px 60px rgba(0,0,0,0.5)"
                  : "0 20px 60px rgba(20,17,15,0.15)",
                zIndex: 300,
              }}
            >
              <div
                style={{
                  padding: "12px 14px 14px",
                  borderBottom: `1px solid ${theme.glassBorder}`,
                  marginBottom: "6px",
                }}
              >
                <div style={{ fontSize: "0.9rem", fontWeight: 600, color: theme.ink, marginBottom: "2px" }}>
                  {user?.displayName || "Planora member"}
                </div>
                <div style={{ fontSize: "0.75rem", color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user?.email}
                </div>
              </div>
              {[
                { label: "Profile", icon: "◐", target: "profile" },
                { label: "Saved plans", icon: "✦", target: "saved" },
                { label: "Settings", icon: "✿", target: "settings" },
              ].map((item) => (
                <button
                  key={item.target}
                  onClick={() => {
                    setUserMenuOpen(false);
                    setPage(item.target);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    background: "transparent",
                    border: "none",
                    borderRadius: "10px",
                    color: theme.ink,
                    fontSize: "0.88rem",
                    fontFamily: fontBody,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = darkMode ? "rgba(255,255,255,0.06)" : "rgba(20,17,15,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: theme.terracotta, width: "16px", textAlign: "center" }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div style={{ height: "1px", background: theme.glassBorder, margin: "6px 0" }} />
              <button
                onClick={handleLogout}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "10px",
                  color: theme.terracotta,
                  fontSize: "0.88rem",
                  fontFamily: fontBody,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = darkMode ? "rgba(232,114,88,0.12)" : "rgba(200,85,61,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ width: "16px", textAlign: "center" }}>⇥</span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  // =====================================================
  // BRAND PANEL (shared by login + signup)
  // =====================================================
  const BrandPanel = ({ heading, sub }) => (
    <div
      style={{
        position: "relative",
        background: `linear-gradient(160deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`,
        padding: "48px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: theme.cream,
        overflow: "hidden",
      }}
    >
      <svg viewBox="0 0 400 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13 }}>
        <rect x="40" y="40" width="320" height="320" fill="none" stroke={theme.gold} strokeWidth="2" />
        <line x1="40" y1="180" x2="220" y2="180" stroke={theme.gold} strokeWidth="2" />
        <line x1="220" y1="40" x2="220" y2="280" stroke={theme.gold} strokeWidth="2" />
        <line x1="220" y1="280" x2="360" y2="280" stroke={theme.gold} strokeWidth="2" />
        <rect x="60" y="60" width="40" height="6" fill={theme.gold} />
        <rect x="300" y="354" width="40" height="6" fill={theme.gold} />
        <circle cx="280" cy="120" r="30" fill="none" stroke={theme.gold} strokeWidth="2" />
      </svg>
      <div style={{ position: "absolute", width: "320px", height: "320px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}33 0%, transparent 70%)`, top: "-80px", right: "-80px" }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, fontFamily: fontDisplay }}>Planora</h1>
        <p style={{ marginTop: "6px", fontSize: "0.78rem", opacity: 0.8, letterSpacing: "1.5px" }}>FLOOR PLANS · INTERIORS · IDEAS</p>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <h2 style={{ fontSize: "2.8rem", lineHeight: 1.1, margin: 0, fontWeight: 600, fontFamily: fontDisplay }}>{heading}</h2>
        <p style={{ marginTop: "20px", maxWidth: "380px", opacity: 0.85, lineHeight: 1.6 }}>{sub}</p>
      </div>

      <div style={{ position: "relative", zIndex: 1, fontSize: "0.78rem", opacity: 0.7 }}>
        © {new Date().getFullYear()} Planora Studio
      </div>
    </div>
  );

  // =====================================================
  // LOGIN PAGE
  // =====================================================
  if (page === "login" && !user) {
    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `linear-gradient(135deg, #0d0b0a 0%, #13100e 100%)`
            : `linear-gradient(135deg, #f0ebe0 0%, #faf5ec 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <BrandPanel
          heading={<>Design the home <br /> you've imagined.</>}
          sub="Sign in to save your floor plans, mood boards, and interior styles — all in one place."
        />

        {/* RIGHT — Login form */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
          <div style={{ width: "100%", maxWidth: "400px" }}>
            <button
              onClick={() => setPage("home")}
              style={{ background: "none", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.85rem", padding: 0, marginBottom: "32px" }}
            >
              ← Back to home
            </button>

            <h2 style={{ fontSize: "2.4rem", fontWeight: 500, margin: "0 0 10px 0", fontFamily: fontDisplay, letterSpacing: "-1px" }}>
              Welcome <em style={{ fontStyle: "italic", color: theme.terracotta }}>back</em>
            </h2>
            <p style={{ color: theme.muted, marginBottom: "32px", fontSize: "0.95rem" }}>
              Sign in to continue designing your space.
            </p>

            <label style={labelStyle}>EMAIL</label>
            <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="planora-input" style={inputStyle} />

            <label style={labelStyle}>PASSWORD</label>
            <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="planora-input" style={inputStyle} />

            {authError && <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 12px" }}>{authError}</p>}

            <button
              onClick={handleEmailLogin}
              disabled={authLoading}
              className="planora-btn"
              style={{
                width: "100%", padding: "14px",
                background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
                color: "#faf5ec", border: "none", borderRadius: "10px",
                fontSize: "0.95rem", fontWeight: 600,
                cursor: authLoading ? "wait" : "pointer",
                marginTop: "8px",
                boxShadow: `0 10px 24px ${theme.forest}30`,
              }}
            >
              {authLoading ? "Signing in..." : "Sign in"}
            </button>

            <div style={{ display: "flex", alignItems: "center", margin: "24px 0", color: theme.muted, fontSize: "0.75rem" }}>
              <div style={{ flex: 1, height: "1px", background: theme.line }} />
              <span style={{ padding: "0 12px" }}>OR</span>
              <div style={{ flex: 1, height: "1px", background: theme.line }} />
            </div>

            <button
              onClick={signInWithGoogle}
              style={{
                ...glassCard(),
                width: "100%", padding: "13px", borderRadius: "10px",
                fontSize: "0.95rem", fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                color: theme.ink,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.8 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
              </svg>
              Continue with Google
            </button>

            <p style={{ marginTop: "32px", textAlign: "center", color: theme.muted, fontSize: "0.88rem" }}>
              Don't have an account?{" "}
              <span onClick={() => { setAuthError(""); setPage("signup"); }} style={{ color: theme.terracotta, fontWeight: 600, cursor: "pointer" }}>
                Sign up
              </span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =====================================================
  // SIGN UP PAGE
  // =====================================================
  if (page === "signup" && !user) {
    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `linear-gradient(135deg, #0d0b0a 0%, #13100e 100%)`
            : `linear-gradient(135deg, #f0ebe0 0%, #faf5ec 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <BrandPanel
          heading={<>Start crafting <br /> your dream space.</>}
          sub="Create an account to generate floor plans, save your favorite styles, and design every room your way."
        />

        {/* RIGHT — Signup form */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
          <div style={{ width: "100%", maxWidth: "400px" }}>
            <button
              onClick={() => setPage("home")}
              style={{ background: "none", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.85rem", padding: 0, marginBottom: "32px" }}
            >
              ← Back to home
            </button>

            <h2 style={{ fontSize: "2.4rem", fontWeight: 500, margin: "0 0 10px 0", fontFamily: fontDisplay, letterSpacing: "-1px" }}>
              Create <em style={{ fontStyle: "italic", color: theme.terracotta }}>account</em>
            </h2>
            <p style={{ color: theme.muted, marginBottom: "28px", fontSize: "0.95rem" }}>Join Planora and design your home in minutes.</p>

            <label style={labelStyle}>FULL NAME</label>
            <input type="text" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} className="planora-input" style={inputStyle} />

            <label style={labelStyle}>EMAIL</label>
            <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="planora-input" style={inputStyle} />

            <label style={labelStyle}>PASSWORD</label>
            <input type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} className="planora-input" style={inputStyle} />

            <label style={labelStyle}>CONFIRM PASSWORD</label>
            <input type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="planora-input" style={inputStyle} />

            {authError && <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 12px" }}>{authError}</p>}

            <button
              onClick={handleSignUp}
              disabled={authLoading}
              className="planora-btn"
              style={{
                width: "100%", padding: "14px",
                background: `linear-gradient(135deg, ${theme.terracotta} 0%, #a8412d 100%)`,
                color: "#faf5ec", border: "none", borderRadius: "10px",
                fontSize: "0.95rem", fontWeight: 600,
                cursor: authLoading ? "wait" : "pointer",
                boxShadow: `0 8px 24px ${theme.terracotta}40`,
              }}
            >
              {authLoading ? "Creating account..." : "Create account"}
            </button>

            <div style={{ display: "flex", alignItems: "center", margin: "22px 0", color: theme.muted, fontSize: "0.75rem" }}>
              <div style={{ flex: 1, height: "1px", background: theme.line }} />
              <span style={{ padding: "0 12px" }}>OR</span>
              <div style={{ flex: 1, height: "1px", background: theme.line }} />
            </div>

            <button
              onClick={signInWithGoogle}
              style={{
                ...glassCard(),
                width: "100%", padding: "13px", borderRadius: "10px",
                fontSize: "0.95rem", fontWeight: 500, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                color: theme.ink,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.8 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
              </svg>
              Continue with Google
            </button>

            <p style={{ marginTop: "28px", textAlign: "center", color: theme.muted, fontSize: "0.88rem" }}>
              Already have an account?{" "}
              <span onClick={() => { setAuthError(""); setPage("login"); }} style={{ color: theme.terracotta, fontWeight: 600, cursor: "pointer" }}>
                Sign in
              </span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =====================================================
  // PASSWORD SETUP MODAL — forced for Google users without password
  // Returns early and blocks all authenticated pages until completed
  // =====================================================
  if (showPasswordSetup && user) {
    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          width: "100%",
          fontFamily: fontBody,
          color: theme.ink,
          background: darkMode
            ? `radial-gradient(ellipse at top left, ${theme.forest}55 0%, transparent 50%),
               radial-gradient(ellipse at bottom right, ${theme.plum}55 0%, transparent 55%),
               linear-gradient(165deg, #0d0b0a 0%, #12100e 50%, #1a1012 100%)`
            : `radial-gradient(ellipse at top left, ${theme.forest}28 0%, transparent 55%),
               radial-gradient(ellipse at bottom right, ${theme.gold}35 0%, transparent 55%),
               linear-gradient(165deg, #faf5ec 0%, #f3ebd9 50%, #f7ecdd 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative blobs */}
        <div style={{ position: "absolute", width: "500px", height: "500px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.terracotta}25 0%, transparent 70%)`, top: "-150px", right: "-150px", pointerEvents: "none" }} />
        <div style={{ position: "absolute", width: "420px", height: "420px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.forest}22 0%, transparent 70%)`, bottom: "-120px", left: "-120px", pointerEvents: "none" }} />

        <div
          className="glass-card anim-scaleIn"
          style={{
            ...glassCard({
              width: "100%",
              maxWidth: "460px",
              padding: "44px 40px",
              borderRadius: "24px",
              position: "relative",
              zIndex: 1,
            }),
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "6px 14px",
              background: `${theme.gold}22`,
              color: theme.plum,
              borderRadius: "20px",
              fontSize: "0.72rem",
              fontWeight: 600,
              letterSpacing: "1.2px",
              marginBottom: "18px",
            }}
          >
            ONE-TIME SETUP
          </div>
          <h2
            style={{
              fontSize: "2rem",
              fontFamily: fontDisplay,
              fontWeight: 500,
              margin: "0 0 10px",
              letterSpacing: "-0.5px",
              lineHeight: 1.1,
            }}
          >
            Create a <em style={{ fontStyle: "italic", color: theme.terracotta }}>backup password</em>
          </h2>
          <p style={{ color: theme.muted, fontSize: "0.92rem", lineHeight: 1.55, margin: "0 0 26px" }}>
            You signed in with Google. Set a password so you can also log in with just your email if you ever lose access to your Google account.
          </p>

          <div
            style={{
              padding: "12px 14px",
              background: darkMode ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)",
              border: `1px solid ${theme.glassBorder}`,
              borderRadius: "10px",
              marginBottom: "20px",
              fontSize: "0.82rem",
              color: theme.muted,
            }}
          >
            Account: <strong style={{ color: theme.ink }}>{user?.email}</strong>
          </div>

          <label style={labelStyle}>NEW PASSWORD</label>
          <input
            type="password"
            placeholder="At least 6 characters"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            className="planora-input"
            style={inputStyle}
          />

          <label style={labelStyle}>CONFIRM PASSWORD</label>
          <input
            type="password"
            placeholder="••••••••"
            value={setupConfirm}
            onChange={(e) => setSetupConfirm(e.target.value)}
            className="planora-input"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSetup(); }}
          />

          {setupError && (
            <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 14px" }}>
              {setupError}
            </p>
          )}

          <button
            onClick={handlePasswordSetup}
            disabled={setupLoading}
            className="planora-btn"
            style={{
              width: "100%",
              padding: "14px",
              background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
              color: "#faf5ec",
              border: "none",
              borderRadius: "10px",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: setupLoading ? "wait" : "pointer",
              letterSpacing: "0.3px",
              marginTop: "6px",
              boxShadow: `0 10px 24px ${theme.forest}40`,
            }}
          >
            {setupLoading ? "Saving..." : "Set password & continue"}
          </button>

          <p
            style={{
              margin: "22px 0 0",
              textAlign: "center",
              color: theme.muted,
              fontSize: "0.78rem",
              lineHeight: 1.5,
            }}
          >
            You'll still be able to sign in with Google — this just adds email + password as a backup.
          </p>
        </div>
      </div>
    );
  }

  // =====================================================
  // ONBOARDING PAGE
  // =====================================================
  if (page === "onboarding" && user) {
    const iconProps = {
      width: 38, height: 38, viewBox: "0 0 40 40", fill: "none",
      stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round",
    };
    const houseTypes = [
      { id: "villa", label: "Villa", desc: "Spacious & luxurious", icon: (<svg {...iconProps}><path d="M6 34h28"/><path d="M8 34V16l12-8 12 8v18"/><path d="M12 34V20m4 14V20m4 14V20m4 14V20m4 14V20"/><path d="M6 16h28"/></svg>) },
      { id: "apartment", label: "Apartment", desc: "Urban & efficient", icon: (<svg {...iconProps}><rect x="9" y="5" width="22" height="30" rx="1"/><path d="M14 11h3M23 11h3M14 17h3M23 17h3M14 23h3M23 23h3"/><path d="M17 35v-6h6v6"/></svg>) },
      { id: "bungalow", label: "Bungalow", desc: "Single-storey comfort", icon: (<svg {...iconProps}><path d="M5 20l15-12 15 12"/><path d="M8 18v16h24V18"/><path d="M17 34v-8h6v8"/><path d="M26 12V7h3v8"/></svg>) },
      { id: "townhouse", label: "Townhouse", desc: "Multi-level living", icon: (<svg {...iconProps}><path d="M4 34h32"/><path d="M6 34V16l7-6 7 6v18"/><path d="M20 34V12l7-5 7 5v22"/><path d="M10 34v-8h6v8"/><path d="M25 34v-9h5v9"/></svg>) },
      { id: "studio", label: "Studio", desc: "Compact & open", icon: (<svg {...iconProps}><rect x="6" y="8" width="28" height="22" rx="1"/><path d="M6 24h28"/><path d="M11 24v-6a3 3 0 013-3h12a3 3 0 013 3v6"/><path d="M9 30v3M31 30v3"/></svg>) },
      { id: "duplex", label: "Duplex", desc: "Two-floor flexibility", icon: (<svg {...iconProps}><path d="M5 18l15-11 15 11"/><path d="M8 16v18h24V16"/><path d="M8 25h24"/><path d="M14 25v-5h5v5M25 34v-6h5v6"/></svg>) },
      { id: "others", label: "Others", desc: "Something different", icon: (<svg {...iconProps}><path d="M20 5v30M5 20h30"/><path d="M9 9l22 22M31 9L9 31"/><circle cx="20" cy="20" r="3"/></svg>) },
    ];

    const styles = [
      { id: "modern", label: "Modern", desc: "Clean lines, bold forms", icon: (<svg {...iconProps}><rect x="6" y="6" width="28" height="28" rx="1"/><path d="M6 16h28M16 6v28"/></svg>) },
      { id: "minimalist", label: "Minimalist", desc: "Less, but better", icon: (<svg {...iconProps}><circle cx="20" cy="20" r="13"/><path d="M20 13v14"/></svg>) },
      { id: "scandinavian", label: "Scandinavian", desc: "Light, warm, natural", icon: (<svg {...iconProps}><path d="M20 5v30"/><path d="M20 12l-5-5M20 12l5-5"/><path d="M20 20l-7-7M20 20l7-7"/><path d="M20 28l-5-5M20 28l5-5"/></svg>) },
      { id: "industrial", label: "Industrial", desc: "Raw & unfinished", icon: (<svg {...iconProps}><circle cx="20" cy="20" r="6"/><path d="M20 5v5M20 30v5M5 20h5M30 20h5M9 9l3.5 3.5M27.5 27.5L31 31M31 9l-3.5 3.5M12.5 27.5L9 31"/></svg>) },
      { id: "bohemian", label: "Bohemian", desc: "Eclectic & layered", icon: (<svg {...iconProps}><path d="M20 35V12"/><path d="M20 12c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M20 18c0-3-2-5-5-5 0 3 2 5 5 5z"/><path d="M20 24c0-3 2-5 5-5 0 3-2 5-5 5z"/><path d="M20 30c0-3-2-5-5-5 0 3 2 5 5 5z"/></svg>) },
      { id: "traditional", label: "Traditional", desc: "Timeless elegance", icon: (<svg {...iconProps}><path d="M6 34h28"/><path d="M8 34V14h24v20"/><path d="M6 14l14-8 14 8"/><path d="M13 34V18M20 34V18M27 34V18"/></svg>) },
    ];

    const Card = ({ active, onClick, children }) => (
      <div
        onClick={onClick}
        className="glass-card planora-card"
        style={{
          padding: "22px",
          borderRadius: "16px",
          ...glassCard(),
          background: active
            ? (darkMode ? `rgba(200,85,61,0.18)` : `rgba(200,85,61,0.1)`)
            : theme.card,
          border: active ? `2px solid ${theme.terracotta}` : `1px solid ${theme.glassBorder}`,
          cursor: "pointer",
          transform: active ? "translateY(-3px)" : "none",
          boxShadow: active
            ? `0 16px 36px ${theme.terracotta}30`
            : (darkMode ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 20px rgba(20,17,15,0.06)"),
        }}
      >
        {children}
      </div>
    );

    const canContinue = houseType && style;

    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `linear-gradient(160deg, #0d0b0a 0%, #13100e 50%, #1a0f15 100%)`
            : `linear-gradient(160deg, #f0ebe0 0%, #faf5ec 50%, #f5f0e8 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Background blobs for glass depth */}
        <div style={{ position: "fixed", width: "600px", height: "600px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.forest}18 0%, transparent 70%)`, top: "-200px", right: "-200px", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.terracotta}12 0%, transparent 70%)`, bottom: "-100px", left: "-100px", pointerEvents: "none", zIndex: 0 }} />

        {/* FULL-WIDTH STICKY HEADER */}
        <AppHeader subtitle="Preferences" />

        {/* CONTENT */}
        <div style={{ padding: "40px 48px 80px", position: "relative", zIndex: 1 }}>
          {/* Hero */}
          <div style={{ maxWidth: "900px", margin: "0 auto 40px" }}>
            <div style={{ display: "inline-block", padding: "6px 14px", background: `${theme.gold}22`, color: theme.plum, borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "1px", marginBottom: "16px" }}>
              STEP 1 OF 1 · TELL US ABOUT YOUR SPACE
            </div>
            <h2 className="anim-fadeUp" style={{ fontSize: "3rem", fontWeight: 500, margin: "0 0 14px", lineHeight: 1.05, fontFamily: fontDisplay, letterSpacing: "-1px" }}>
              Let's design <em style={{ fontStyle: "italic", color: theme.terracotta }}>your perfect</em> home.
            </h2>
            <p style={{ color: theme.muted, fontSize: "1.05rem", maxWidth: "600px", lineHeight: 1.6 }}>
              Choose your house type and preferred style — we'll generate floor plans tailored to how you actually want to live.
            </p>
          </div>

          {/* HOUSE TYPE */}
          <section style={{ maxWidth: "1100px", margin: "0 auto 48px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>House Type</h3>
            <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>What kind of home are you designing?</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px" }}>
              {houseTypes.map((h) => (
                <Card key={h.id} active={houseType === h.id} onClick={() => setHouseType(h.id)}>
                  <div style={{ marginBottom: "12px", color: houseType === h.id ? theme.terracotta : theme.forest, transition: "color 0.3s ease", display: "flex" }}>{h.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "4px" }}>{h.label}</div>
                  <div style={{ color: theme.muted, fontSize: "0.82rem" }}>{h.desc}</div>
                </Card>
              ))}
            </div>
          </section>

          {/* STYLE TYPE */}
          <section style={{ maxWidth: "1100px", margin: "0 auto 48px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>Style</h3>
            <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>Pick the aesthetic that feels like home.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
              {styles.map((s) => (
                <Card key={s.id} active={style === s.id} onClick={() => setStyle(s.id)}>
                  <div style={{ marginBottom: "12px", color: style === s.id ? theme.terracotta : theme.forest, transition: "color 0.3s ease", display: "flex" }}>{s.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "4px" }}>{s.label}</div>
                  <div style={{ color: theme.muted, fontSize: "0.82rem" }}>{s.desc}</div>
                </Card>
              ))}
            </div>
          </section>

          {/* DETAILS — only shown when a house type is selected */}
          {houseType && (
            <section className="anim-fadeUp" style={{ maxWidth: "1100px", margin: "0 auto 32px" }}>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>A few details</h3>
              <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>
                Specific to your {houseType === "others" ? "space" : houseType}.
              </p>
              <div
                className="glass-card"
                style={{
                  ...glassCard({ padding: "24px", borderRadius: "14px" }),
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "16px",
                }}
              >
                {/* Always visible when houseType is selected */}
                <div>
                  <label style={labelStyle}>BEDROOMS</label>
                  <input type="number" min="1" placeholder="e.g. 3" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="planora-input" style={inputStyle} />
                </div>

                {/* VILLA / BUNGALOW */}
                {(houseType === "villa" || houseType === "bungalow") && (
                  <>
                    <div>
                      <label style={labelStyle}>NUMBER OF FLOORS</label>
                      <input type="number" min="1" placeholder="e.g. 2" value={floors} onChange={(e) => setFloors(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>PLOT AREA (SQ.FT)</label>
                      <input type="number" min="1" placeholder="e.g. 2400" value={plotArea} onChange={(e) => setPlotArea(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>GARDEN?</label>
                      <select value={hasGarden} onChange={(e) => setHasGarden(e.target.value)} className="planora-input" style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="">Select…</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>PARKING SPACES</label>
                      <input type="number" min="0" placeholder="e.g. 2" value={hasParking} onChange={(e) => setHasParking(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                  </>
                )}

                {/* APARTMENT / STUDIO */}
                {(houseType === "apartment" || houseType === "studio") && (
                  <>
                    <div>
                      <label style={labelStyle}>FLOOR NUMBER</label>
                      <input type="number" min="0" placeholder="e.g. 7" value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>CARPET AREA (SQ.FT)</label>
                      <input type="number" min="1" placeholder="e.g. 1200" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>BALCONY?</label>
                      <select value={hasBalcony} onChange={(e) => setHasBalcony(e.target.value)} className="planora-input" style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="">Select…</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </>
                )}

                {/* TOWNHOUSE / DUPLEX */}
                {(houseType === "townhouse" || houseType === "duplex") && (
                  <>
                    <div>
                      <label style={labelStyle}>NUMBER OF FLOORS</label>
                      <input type="number" min="1" placeholder="e.g. 2" value={floors} onChange={(e) => setFloors(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>CARPET AREA (SQ.FT)</label>
                      <input type="number" min="1" placeholder="e.g. 1800" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>PARKING SPACES</label>
                      <input type="number" min="0" placeholder="e.g. 1" value={hasParking} onChange={(e) => setHasParking(e.target.value)} className="planora-input" style={inputStyle} />
                    </div>
                  </>
                )}

                {/* OTHERS */}
                {houseType === "others" && (
                  <div>
                    <label style={labelStyle}>AREA (SQ.FT)</label>
                    <input type="number" min="1" placeholder="e.g. 1500" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} />
                  </div>
                )}

                {/* Always visible — budget */}
                <div>
                  <label style={labelStyle}>BUDGET (OPTIONAL)</label>
                  <input type="text" placeholder="e.g. ₹50L" value={budget} onChange={(e) => setBudget(e.target.value)} className="planora-input" style={inputStyle} />
                </div>
              </div>
            </section>
          )}

          {/* PERSONAL PREFERENCES */}
          <section style={{ maxWidth: "1100px", margin: "0 auto 32px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>
              Personal preferences <span style={{ color: theme.muted, fontWeight: 400, fontSize: "0.85rem" }}>· optional</span>
            </h3>
            <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>
              Tell us anything specific — pet-friendly, home office, big kitchen, natural light…
            </p>
            <div className="glass-card" style={{ ...glassCard({ padding: "24px", borderRadius: "14px" }) }}>
              <label style={labelStyle}>DESCRIPTION</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. I work from home, love natural light, need a pet corner, prefer open kitchen…"
                rows={4}
                className="planora-input"
                style={{ ...inputStyle, resize: "vertical", fontFamily: fontBody, lineHeight: 1.5, minHeight: "100px" }}
              />
            </div>
          </section>

          {/* BLUEPRINT UPLOAD */}
          <section style={{ maxWidth: "1100px", margin: "0 auto 48px" }}>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>
              Existing blueprint <span style={{ color: theme.muted, fontWeight: 400, fontSize: "0.85rem" }}>· optional</span>
            </h3>
            <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>
              Upload a plot or apartment blueprint if you have one.
            </p>
            <label
              htmlFor="blueprint-upload"
              className="glass-card"
              style={{
                display: "block",
                ...glassCard({ padding: "40px 24px", borderRadius: "14px" }),
                border: `2px dashed ${blueprintFile ? theme.terracotta : theme.glassBorder}`,
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color 0.25s ease",
              }}
            >
              <input id="blueprint-upload" type="file" accept="image/*,.pdf,.dwg,.dxf" onChange={(e) => setBlueprintFile(e.target.files[0] || null)} style={{ display: "none" }} />
              {blueprintFile ? (
                <div>
                  <div style={{ fontSize: "2rem", marginBottom: "10px" }}>📐</div>
                  <div style={{ fontWeight: 600, color: theme.ink, marginBottom: "4px" }}>{blueprintFile.name}</div>
                  <div style={{ fontSize: "0.82rem", color: theme.muted }}>{(blueprintFile.size / 1024).toFixed(1)} KB · Click to change</div>
                  <button type="button" onClick={(e) => { e.preventDefault(); setBlueprintFile(null); }} style={{ marginTop: "12px", background: "transparent", border: `1px solid ${theme.glassBorder}`, color: theme.muted, padding: "6px 14px", borderRadius: "999px", cursor: "pointer", fontSize: "0.78rem", fontFamily: fontBody }}>
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "2rem", marginBottom: "10px", opacity: 0.4 }}>⬆</div>
                  <div style={{ fontWeight: 600, color: theme.ink, marginBottom: "4px" }}>Drop your blueprint here</div>
                  <div style={{ fontSize: "0.82rem", color: theme.muted }}>PNG, JPG, PDF, DWG, or DXF · Max 10MB</div>
                </div>
              )}
            </label>
          </section>

          {/* CTA */}
          <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              className="planora-btn"
              onClick={() => { setHouseType(""); setStyle(""); setBedrooms(""); setBudget(""); setFloors(""); setPlotArea(""); setFloorNumber(""); setCarpetArea(""); setHasBalcony(""); setHasGarden(""); setHasParking(""); setDescription(""); setBlueprintFile(null); }}
              style={{ padding: "14px 24px", background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: theme.muted, border: `1px solid ${theme.glassBorder}`, borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem", fontWeight: 500, fontFamily: fontBody }}
            >
              Reset
            </button>
            <button
              className="planora-btn"
              disabled={!canContinue}
              onClick={() => { setOnboardingDone(true); setPage("generator"); }}
              style={{
                padding: "14px 32px",
                background: canContinue ? `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)` : theme.line,
                color: "#faf5ec", border: "none", borderRadius: "999px",
                cursor: canContinue ? "pointer" : "not-allowed",
                fontSize: "0.95rem", fontWeight: 600, letterSpacing: "0.3px",
                boxShadow: canContinue ? `0 10px 24px ${theme.forest}40` : "none",
                fontFamily: fontBody,
              }}
            >
              Continue to Generator →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =====================================================
  // PROFILE PAGE
  // =====================================================
  if (page === "profile" && user) {
    const initials = (user?.displayName || user?.email || "U")
      .split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `linear-gradient(160deg, #0d0b0a 0%, #13100e 50%, #1a0f15 100%)`
            : `linear-gradient(160deg, #f0ebe0 0%, #faf5ec 50%, #f5f0e8 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Background blobs */}
        <div style={{ position: "fixed", width: "500px", height: "500px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.plum}15 0%, transparent 70%)`, top: "-100px", right: "-100px", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}10 0%, transparent 70%)`, bottom: "-80px", left: "10%", pointerEvents: "none", zIndex: 0 }} />

        {/* FULL-WIDTH STICKY HEADER */}
        <AppHeader
          subtitle="Profile"
          extraActions={
            <button
              className="planora-btn"
              onClick={() => setPage("generator")}
              style={{ padding: "8px 18px", borderRadius: "999px", cursor: "pointer", background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${theme.glassBorder}`, fontSize: "0.85rem", color: theme.ink, fontFamily: fontBody }}
            >
              ← Studio
            </button>
          }
        />

        {/* CONTENT */}
        <div style={{ padding: "40px 48px 80px", position: "relative", zIndex: 1 }}>
          {/* PROFILE HERO */}
          <div
            className="anim-fadeUp grain"
            style={{
              background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 50%, ${theme.plum} 100%)`,
              padding: "48px",
              borderRadius: "24px",
              color: "#faf5ec",
              marginBottom: "40px",
              display: "flex",
              alignItems: "center",
              gap: "32px",
              flexWrap: "wrap",
              position: "relative",
              overflow: "hidden",
              boxShadow: `0 24px 60px ${theme.forest}40`,
            }}
          >
            <div style={{ position: "absolute", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}25 0%, transparent 70%)`, top: "-150px", right: "-80px", pointerEvents: "none" }} />

            {/* Avatar */}
            <div
              className="anim-scaleIn"
              style={{
                width: "120px", height: "120px", borderRadius: "50%",
                background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "2.6rem", fontFamily: fontDisplay, fontWeight: 600, color: "#faf5ec",
                border: "4px solid rgba(250,245,236,0.2)",
                boxShadow: `0 20px 50px ${theme.terracotta}40`,
                position: "relative", zIndex: 1, flexShrink: 0,
              }}
            >
              {initials}
            </div>

            {/* Info */}
            <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: "240px" }}>
              <div style={{ fontSize: "0.72rem", letterSpacing: "2px", opacity: 0.7, fontWeight: 600, marginBottom: "8px" }}>✦ PLANORA MEMBER</div>
              <h2 style={{ fontSize: "2.8rem", fontFamily: fontDisplay, fontWeight: 500, margin: "0 0 6px", letterSpacing: "-1px", lineHeight: 1.05 }}>
                {user?.displayName || "Welcome"}
              </h2>
              <p style={{ margin: "0 0 20px", opacity: 0.8, fontSize: "0.95rem" }}>{user?.email}</p>
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>{savedDesigns.length}</div>
                  <div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Saved designs</div>
                </div>
                <div style={{ width: "1px", background: "rgba(250,245,236,0.3)" }} />
                <div>
                  <div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>
                    {savedDesigns.reduce((acc, d) => acc + (d.rooms?.length || 0), 0)}
                  </div>
                  <div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Rooms designed</div>
                </div>
                <div style={{ width: "1px", background: "rgba(250,245,236,0.3)" }} />
                <div>
                  <div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>∞</div>
                  <div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Saves left</div>
                </div>
              </div>
            </div>
          </div>

          {/* PREFERENCES CARD */}
          <div
            className="anim-fadeUp glass-card"
            style={{ ...glassCard({ padding: "32px", borderRadius: "20px", marginBottom: "40px", animationDelay: "0.1s" }) }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "1.3rem", fontFamily: fontDisplay, fontWeight: 600 }}>Your preferences</h3>
              <button
                className="planora-btn"
                onClick={() => setPage("onboarding")}
                style={{ background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${theme.glassBorder}`, padding: "8px 16px", borderRadius: "999px", cursor: "pointer", color: theme.ink, fontSize: "0.82rem", fontFamily: fontBody }}
              >
                Edit
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "20px" }}>
              {[
                { label: "HOUSE TYPE", value: houseType },
                { label: "STYLE", value: style },
                { label: "BEDROOMS", value: bedrooms },
                { label: "BUDGET", value: budget },
              ].map((item, i) => (
                <div key={i}>
                  <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>{item.label}</div>
                  <div style={{ fontSize: "1.1rem", fontFamily: fontDisplay, fontWeight: 500, textTransform: ["HOUSE TYPE", "STYLE"].includes(item.label) ? "capitalize" : "none", color: item.value ? theme.ink : theme.muted }}>
                    {item.value || "—"}
                  </div>
                </div>
              ))}
            </div>
            {description && (
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: `1px solid ${theme.line}` }}>
                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "6px" }}>YOUR NOTES</div>
                <p style={{ margin: 0, color: theme.ink, lineHeight: 1.6, fontSize: "0.95rem", fontStyle: "italic" }}>"{description}"</p>
              </div>
            )}
          </div>

          {/* SAVED DESIGNS */}
          <div className="anim-fadeUp" style={{ animationDelay: "0.2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-0.5px" }}>
                Saved <em style={{ fontStyle: "italic", color: theme.terracotta }}>designs</em>
              </h3>
              <span style={{ color: theme.muted, fontSize: "0.9rem" }}>{savedDesigns.length} saved · click any to reopen</span>
            </div>

            {savedDesigns.length === 0 ? (
              <div
                className="glass-card"
                style={{
                  ...glassCard({ padding: "72px 20px", borderRadius: "20px" }),
                  textAlign: "center",
                  border: `2px dashed ${theme.glassBorder}`,
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: "16px", opacity: 0.4 }}>✦</div>
                <h4 style={{ fontFamily: fontDisplay, fontWeight: 500, fontSize: "1.3rem", margin: "0 0 8px" }}>No saved designs yet</h4>
                <p style={{ color: theme.muted, margin: "0 0 20px", fontSize: "0.95rem" }}>Generate your first layout and hit save — it'll show up here.</p>
                <button
                  className="planora-btn"
                  onClick={() => setPage("generator")}
                  style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: "#faf5ec", padding: "12px 28px", border: "none", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontFamily: fontBody, fontSize: "0.9rem", boxShadow: `0 10px 24px ${theme.forest}40` }}
                >
                  Start designing →
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
                {savedDesigns.map((d, i) => (
                  <div
                    key={d.id}
                    onClick={() => loadSavedDesign(d)}
                    className="glass-card planora-card anim-scaleIn"
                    style={{ ...glassCard({ padding: "24px", borderRadius: "18px", animationDelay: `${i * 0.08}s`, position: "relative", overflow: "hidden" }), cursor: "pointer" }}
                  >
                    <div
                      style={{
                        aspectRatio: "16/9",
                        background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
                        borderRadius: "12px", marginBottom: "16px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <svg viewBox="0 0 200 120" style={{ width: "75%", height: "75%" }}>
                        <rect x="10" y="10" width="180" height="100" fill="none" stroke={theme.gold} strokeWidth="1.5" />
                        <line x1="10" y1="60" x2="110" y2="60" stroke={theme.gold} strokeWidth="1.5" />
                        <line x1="110" y1="10" x2="110" y2="90" stroke={theme.gold} strokeWidth="1.5" />
                        <rect x="20" y="20" width="16" height="3" fill={theme.terracotta} />
                        <rect x="160" y="107" width="16" height="3" fill={theme.terracotta} />
                        <circle cx="150" cy="35" r="10" fill="none" stroke={theme.gold} strokeWidth="1" />
                      </svg>
                      <div style={{ position: "absolute", top: "10px", right: "10px", background: "rgba(250,245,236,0.9)", color: theme.ink, fontSize: "0.68rem", fontWeight: 600, padding: "4px 10px", borderRadius: "999px" }}>
                        {d.rooms.length} ROOMS
                      </div>
                    </div>
                    <h4 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontFamily: fontDisplay, fontWeight: 600, textTransform: "capitalize", letterSpacing: "-0.3px" }}>{d.name}</h4>
                    <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
                      {d.houseType && <span style={{ fontSize: "0.7rem", background: `${theme.forest}15`, color: theme.forest, padding: "3px 10px", borderRadius: "999px", textTransform: "capitalize", fontWeight: 600 }}>{d.houseType}</span>}
                      {d.style && <span style={{ fontSize: "0.7rem", background: `${theme.terracotta}15`, color: theme.terracotta, padding: "3px 10px", borderRadius: "999px", textTransform: "capitalize", fontWeight: 600 }}>{d.style}</span>}
                      {d.bedrooms && <span style={{ fontSize: "0.7rem", background: `${theme.gold}20`, color: darkMode ? theme.gold : "#8b6f0a", padding: "3px 10px", borderRadius: "999px", fontWeight: 600 }}>{d.bedrooms} BR</span>}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: theme.muted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Saved {d.savedAt}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSavedDesigns((prev) => prev.filter((x) => x.id !== d.id)); }}
                        style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.78rem", padding: 0, fontFamily: fontBody }}
                        className="planora-link"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =====================================================
  // SAVED PLANS PAGE
  // =====================================================
  if (page === "saved" && user) {
    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `radial-gradient(ellipse at top right, ${theme.plum}45 0%, transparent 55%),
               radial-gradient(ellipse at bottom left, ${theme.forest}35 0%, transparent 55%),
               linear-gradient(165deg, #0d0b0a 0%, #13100e 50%, #1a0f15 100%)`
            : `radial-gradient(ellipse at top right, ${theme.gold}28 0%, transparent 55%),
               radial-gradient(ellipse at bottom left, ${theme.forest}20 0%, transparent 55%),
               linear-gradient(165deg, #f0ebe0 0%, #faf5ec 50%, #f5f0e8 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Decorative blobs */}
        <div style={{ position: "fixed", width: "500px", height: "500px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}18 0%, transparent 70%)`, top: "-100px", right: "-100px", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.terracotta}12 0%, transparent 70%)`, bottom: "-80px", left: "5%", pointerEvents: "none", zIndex: 0 }} />

        <AppHeader
          subtitle="Saved"
          extraActions={
            <button
              className="planora-btn"
              onClick={() => setPage("generator")}
              style={{ padding: "8px 18px", borderRadius: "999px", cursor: "pointer", background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${theme.glassBorder}`, fontSize: "0.85rem", color: theme.ink, fontFamily: fontBody }}
            >
              ← Studio
            </button>
          }
        />

        {/* CONTENT */}
        <div style={{ padding: "48px 48px 80px", position: "relative", zIndex: 1, maxWidth: "1200px", margin: "0 auto", width: "100%" }}>
          {/* Hero */}
          <div className="anim-fadeUp" style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "10px" }}>
              ✦ YOUR LIBRARY
            </div>
            <h2 style={{ fontSize: "2.8rem", margin: 0, fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-1px", lineHeight: 1.05 }}>
              Saved <em style={{ fontStyle: "italic", color: theme.terracotta }}>floor plans</em>
            </h2>
            <p style={{ color: theme.muted, fontSize: "1rem", marginTop: "10px", maxWidth: "560px", lineHeight: 1.55 }}>
              Every plan you've saved lives here. Click any card to <strong style={{ color: theme.ink }}>reopen and edit it</strong> in the studio.
            </p>
          </div>

          {/* Stats strip */}
          <div
            className="anim-fadeUp glass-card"
            style={{
              ...glassCard({ padding: "24px 28px", borderRadius: "18px", marginBottom: "28px" }),
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "24px",
            }}
          >
            {[
              { label: "SAVED", value: savedDesigns.length },
              { label: "ROOMS", value: savedDesigns.reduce((a, d) => a + (d.rooms?.length || 0), 0) },
              { label: "PLAN", value: "Free · ∞" },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "6px" }}>{s.label}</div>
                <div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.ink }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Grid or empty state */}
          {savedDesigns.length === 0 ? (
            <div
              className="glass-card anim-fadeUp"
              style={{
                ...glassCard({ padding: "72px 20px", borderRadius: "20px" }),
                textAlign: "center",
                border: `2px dashed ${theme.glassBorder}`,
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "14px", opacity: 0.5 }}>✦</div>
              <h3 style={{ margin: "0 0 8px", fontFamily: fontDisplay, fontWeight: 500, fontSize: "1.4rem" }}>No saved plans yet</h3>
              <p style={{ color: theme.muted, margin: "0 0 22px", fontSize: "0.92rem" }}>
                Generate a design in the studio and hit save to start your library.
              </p>
              <button
                className="planora-btn"
                onClick={() => setPage("generator")}
                style={{
                  padding: "12px 26px",
                  background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
                  color: "#faf5ec",
                  border: "none",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  fontFamily: fontBody,
                  boxShadow: `0 10px 24px ${theme.forest}40`,
                }}
              >
                Open Studio →
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "22px",
              }}
            >
              {savedDesigns.map((d, i) => (
                <div
                  key={d.id || i}
                  onClick={() => loadSavedDesign(d)}
                  className="glass-card planora-card anim-scaleIn"
                  style={{
                    ...glassCard({
                      padding: "24px",
                      borderRadius: "18px",
                      animationDelay: `${i * 0.06}s`,
                      position: "relative",
                      overflow: "hidden",
                    }),
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      width: "140px",
                      height: "140px",
                      borderRadius: "50%",
                      background: `radial-gradient(circle, ${theme.terracotta}18 0%, transparent 70%)`,
                      transform: "translate(40%, -40%)",
                      pointerEvents: "none",
                    }}
                  />
                  <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "8px" }}>
                    {d.savedAt || "SAVED"}
                  </div>
                  <h3 style={{ margin: "0 0 10px", fontFamily: fontDisplay, fontSize: "1.25rem", fontWeight: 600, textTransform: "capitalize", position: "relative", zIndex: 1 }}>
                    {d.name}
                  </h3>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px", position: "relative", zIndex: 1 }}>
                    {[d.style, d.houseType, `${d.bedrooms || "?"} BR`].filter(Boolean).map((tag, ti) => (
                      <span
                        key={ti}
                        style={{
                          padding: "4px 10px",
                          fontSize: "0.7rem",
                          borderRadius: "999px",
                          background: `${theme.forest}18`,
                          color: theme.forest,
                          fontWeight: 600,
                          textTransform: "capitalize",
                          letterSpacing: "0.3px",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: theme.muted, lineHeight: 1.5, position: "relative", zIndex: 1 }}>
                    {(d.rooms || []).slice(0, 4).join(" · ")}
                    {(d.rooms || []).length > 4 ? "…" : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // =====================================================
  // SETTINGS PAGE
  // =====================================================
  if (page === "settings" && user) {
    const hasPasswordProvider = user.providerData.some((p) => p.providerId === "password");

    const handleChangePassword = async () => {
      setSetupError("");
      if (setupPassword.length < 6) return setSetupError("Password must be at least 6 characters.");
      if (setupPassword !== setupConfirm) return setSetupError("Passwords do not match.");
      try {
        setSetupLoading(true);
        await updatePassword(auth.currentUser, setupPassword);
        setSetupPassword("");
        setSetupConfirm("");
        alert("Password updated successfully.");
      } catch (err) {
        if (err.code === "auth/requires-recent-login") {
          setSetupError("For security, please sign out and sign back in before changing your password.");
        } else {
          setSetupError(err.message || "Failed to update password.");
        }
      } finally {
        setSetupLoading(false);
      }
    };

    const SectionCard = ({ title, subtitle, children }) => (
      <div
        className="glass-card anim-fadeUp"
        style={{ ...glassCard({ padding: "28px 30px", borderRadius: "18px", marginBottom: "20px" }) }}
      >
        <h3 style={{ margin: "0 0 4px", fontFamily: fontDisplay, fontSize: "1.2rem", fontWeight: 600 }}>{title}</h3>
        {subtitle && <p style={{ margin: "0 0 18px", color: theme.muted, fontSize: "0.88rem" }}>{subtitle}</p>}
        {children}
      </div>
    );

    return (
      <div
        className="anim-fadeIn"
        style={{
          minHeight: "100vh",
          background: darkMode
            ? `radial-gradient(ellipse at top left, ${theme.forest}40 0%, transparent 55%),
               radial-gradient(ellipse at bottom right, ${theme.plum}45 0%, transparent 55%),
               linear-gradient(165deg, #0d0b0a 0%, #13100e 50%, #1a0f15 100%)`
            : `radial-gradient(ellipse at top left, ${theme.forest}20 0%, transparent 55%),
               radial-gradient(ellipse at bottom right, ${theme.plum}1a 0%, transparent 55%),
               linear-gradient(165deg, #f0ebe0 0%, #faf5ec 50%, #f5f0e8 100%)`,
          fontFamily: fontBody,
          color: theme.ink,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Decorative blobs */}
        <div style={{ position: "fixed", width: "500px", height: "500px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.forest}18 0%, transparent 70%)`, top: "-120px", left: "-120px", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}15 0%, transparent 70%)`, bottom: "-100px", right: "5%", pointerEvents: "none", zIndex: 0 }} />

        <AppHeader
          subtitle="Settings"
          extraActions={
            <button
              className="planora-btn"
              onClick={() => setPage("generator")}
              style={{ padding: "8px 18px", borderRadius: "999px", cursor: "pointer", background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${theme.glassBorder}`, fontSize: "0.85rem", color: theme.ink, fontFamily: fontBody }}
            >
              ← Studio
            </button>
          }
        />

        {/* CONTENT */}
        <div style={{ padding: "48px 48px 80px", position: "relative", zIndex: 1, maxWidth: "780px", margin: "0 auto", width: "100%" }}>
          {/* Hero */}
          <div className="anim-fadeUp" style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "10px" }}>
              ✿ ACCOUNT
            </div>
            <h2 style={{ fontSize: "2.8rem", margin: 0, fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-1px", lineHeight: 1.05 }}>
              Settings
            </h2>
            <p style={{ color: theme.muted, fontSize: "1rem", marginTop: "10px", lineHeight: 1.55 }}>
              Manage your account, preferences, and how Planora looks.
            </p>
          </div>

          {/* Account info */}
          <SectionCard title="Account" subtitle="Your Planora identity.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "18px" }}>
              <div>
                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>NAME</div>
                <div style={{ fontSize: "1rem", color: theme.ink }}>{user?.displayName || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>EMAIL</div>
                <div style={{ fontSize: "1rem", color: theme.ink, wordBreak: "break-all" }}>{user?.email}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>SIGN-IN METHODS</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {user.providerData.map((p) => (
                    <span
                      key={p.providerId}
                      style={{
                        padding: "4px 10px",
                        fontSize: "0.72rem",
                        borderRadius: "999px",
                        background: `${theme.forest}18`,
                        color: theme.forest,
                        fontWeight: 600,
                        textTransform: "capitalize",
                      }}
                    >
                      {p.providerId === "google.com" ? "Google" : p.providerId === "password" ? "Email" : p.providerId}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Appearance */}
          <SectionCard title="Appearance" subtitle="Light mode follows your system by default.">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: "4px" }}>
                  {darkMode ? "Dark mode" : "Light mode"}
                </div>
                <div style={{ fontSize: "0.82rem", color: theme.muted }}>
                  Toggle between warm cream and deep ink themes.
                </div>
              </div>
              <button
                className="planora-btn"
                onClick={() => setDarkMode(!darkMode)}
                style={{
                  width: "64px",
                  height: "34px",
                  borderRadius: "999px",
                  border: `1px solid ${theme.glassBorder}`,
                  background: darkMode ? theme.forest : theme.gold + "44",
                  position: "relative",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: darkMode ? "33px" : "3px",
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background: "#faf5ec",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                    transition: "left 0.25s cubic-bezier(0.22,1,0.36,1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8rem",
                    color: darkMode ? theme.gold : theme.forest,
                  }}
                >
                  {darkMode ? "☾" : "☀"}
                </span>
              </button>
            </div>
          </SectionCard>

          {/* Preferences */}
          <SectionCard title="Design preferences" subtitle="Your house type, style, bedrooms, and budget.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", marginBottom: "20px" }}>
              {[
                { label: "HOUSE TYPE", value: houseType || "—" },
                { label: "STYLE", value: style || "—" },
                { label: "BEDROOMS", value: bedrooms || "—" },
                { label: "BUDGET", value: budget || "—" },
              ].map((item) => (
                <div key={item.label}>
                  <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>{item.label}</div>
                  <div style={{ fontSize: "1rem", color: theme.ink, textTransform: "capitalize" }}>{item.value}</div>
                </div>
              ))}
            </div>
            <button
              className="planora-btn"
              onClick={() => setPage("onboarding")}
              style={{
                padding: "10px 22px",
                background: theme.glass,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                border: `1px solid ${theme.glassBorder}`,
                color: theme.ink,
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontFamily: fontBody,
              }}
            >
              Edit preferences →
            </button>
          </SectionCard>

          {/* Change password */}
          <SectionCard
            title={hasPasswordProvider ? "Change password" : "Set a password"}
            subtitle={
              hasPasswordProvider
                ? "Pick a new password for this account."
                : "Add a password so you can log in without Google."
            }
          >
            <label style={labelStyle}>NEW PASSWORD</label>
            <input
              type="password"
              placeholder="At least 6 characters"
              value={setupPassword}
              onChange={(e) => setSetupPassword(e.target.value)}
              className="planora-input"
              style={inputStyle}
            />
            <label style={labelStyle}>CONFIRM PASSWORD</label>
            <input
              type="password"
              placeholder="••••••••"
              value={setupConfirm}
              onChange={(e) => setSetupConfirm(e.target.value)}
              className="planora-input"
              style={inputStyle}
            />
            {setupError && (
              <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 12px" }}>{setupError}</p>
            )}
            <button
              className="planora-btn"
              onClick={hasPasswordProvider ? handleChangePassword : handlePasswordSetup}
              disabled={setupLoading}
              style={{
                padding: "12px 26px",
                background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
                color: "#faf5ec",
                border: "none",
                borderRadius: "999px",
                cursor: setupLoading ? "wait" : "pointer",
                fontSize: "0.88rem",
                fontWeight: 600,
                fontFamily: fontBody,
                boxShadow: `0 10px 24px ${theme.forest}40`,
              }}
            >
              {setupLoading ? "Saving..." : hasPasswordProvider ? "Update password" : "Set password"}
            </button>
          </SectionCard>

          {/* Danger zone */}
          <SectionCard title="Sign out" subtitle="You can sign back in anytime with Google or your email.">
            <button
              className="planora-btn"
              onClick={handleLogout}
              style={{
                padding: "12px 26px",
                background: "transparent",
                color: theme.terracotta,
                border: `1px solid ${theme.terracotta}55`,
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: "0.88rem",
                fontWeight: 600,
                fontFamily: fontBody,
              }}
            >
              Log out
            </button>
          </SectionCard>
        </div>
      </div>
    );
  }

  // =====================================================
  // HOME / LANDING PAGE
  // =====================================================
  if (page === "home" && !user) {
    const features = [
      { icon: "✦", title: "AI Floor Planning", desc: "Describe your life. Get a layout that actually fits how you live — not a template." },
      { icon: "◈", title: "50+ Style Presets", desc: "From minimalist Scandi to maximalist bohemian — switch aesthetics in one click." },
      { icon: "◉", title: "Room-by-Room", desc: "Fine-tune every space. Adjust dimensions, furniture, light, and flow." },
      { icon: "✺", title: "3D Preview", desc: "Walk through your plan in interactive 3D before a single wall goes up." },
      { icon: "⬡", title: "Export & Share", desc: "Download print-ready PDFs or share with your architect in a click." },
      { icon: "✧", title: "Mood Boards", desc: "Pin materials, colors, and inspiration — all tied to your floor plan." },
    ];
    const steps = [
      { n: "01", title: "Tell us about your space", desc: "House type, size, family, and budget." },
      { n: "02", title: "Pick your style", desc: "Modern, boho, industrial — or mix them." },
      { n: "03", title: "Generate & refine", desc: "AI lays it out. You tweak. Done." },
    ];
    const marqueeItems = ["Villas", "Apartments", "Bungalows", "Studios", "Duplexes", "Townhouses", "Cottages", "Lofts"];

    return (
      <div
        style={{
          background: darkMode
            ? `radial-gradient(ellipse at top left, ${theme.forest}40 0%, transparent 45%),
               radial-gradient(ellipse at top right, ${theme.plum}55 0%, transparent 50%),
               radial-gradient(ellipse at bottom left, ${theme.terracotta}35 0%, transparent 55%),
               radial-gradient(ellipse at bottom right, ${theme.gold}25 0%, transparent 50%),
               linear-gradient(165deg, #0d0b0a 0%, #12100e 40%, #1a1012 100%)`
            : `radial-gradient(ellipse at top left, ${theme.forest}22 0%, transparent 50%),
               radial-gradient(ellipse at top right, ${theme.plum}1c 0%, transparent 55%),
               radial-gradient(ellipse at bottom left, ${theme.terracotta}28 0%, transparent 55%),
               radial-gradient(ellipse at bottom right, ${theme.gold}30 0%, transparent 50%),
               linear-gradient(165deg, #faf5ec 0%, #f3ebd9 45%, #f7ecdd 100%)`,
          backgroundAttachment: "fixed",
          color: theme.ink,
          minHeight: "100vh",
          fontFamily: fontBody,
          overflow: "hidden",
        }}
      >
        {/* NAV */}
        <nav
          className="anim-fadeIn"
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0 48px", height: "68px",
            position: "sticky", top: 0, left: 0, right: 0, width: "100%",
            zIndex: 100,
            background: darkMode ? "rgba(10,9,8,0.72)" : "rgba(242,237,226,0.72)",
            backdropFilter: "blur(28px) saturate(200%)",
            WebkitBackdropFilter: "blur(28px) saturate(200%)",
            borderBottom: `1px solid ${theme.glassBorder}`,
            boxSizing: "border-box",
            margin: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width="26" height="26" viewBox="0 0 40 40">
              <rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" />
              <line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" />
              <line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" />
              <circle cx="30" cy="12" r="3" fill={theme.terracotta} />
            </svg>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, fontFamily: fontDisplay }}>Planora</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
            <a href="#features" className="planora-link" style={{ color: theme.ink, textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>Features</a>
            <a href="#how" className="planora-link" style={{ color: theme.ink, textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>How it works</a>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                className="planora-btn"
                onClick={() => setDarkMode(!darkMode)}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                style={{ width: "40px", height: "40px", borderRadius: "50%", background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: `1px solid ${theme.glassBorder}`, cursor: "pointer", fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center", color: darkMode ? theme.gold : theme.forest }}
              >
                {darkMode ? "☀" : "☾"}
              </button>
              <button
                className="planora-btn"
                onClick={() => setPage("login")}
                style={{ background: theme.glass, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: theme.ink, border: `1px solid ${theme.glassBorder}`, padding: "10px 22px", borderRadius: "999px", fontWeight: 500, cursor: "pointer", fontFamily: fontBody }}
              >
                Login
              </button>
              <button
                className="planora-btn"
                onClick={() => setPage("signup")}
                style={{ background: theme.terracotta, color: "#faf5ec", border: "none", padding: "10px 24px", borderRadius: "999px", fontWeight: 600, cursor: "pointer", boxShadow: `0 6px 20px ${theme.terracotta}50`, fontFamily: fontBody }}
              >
                Sign up
              </button>
            </div>
          </div>
        </nav>

        {/* HERO */}
        <section style={{ position: "relative", padding: "80px 48px 100px", overflow: "hidden" }} className="grain">
          <div style={{ position: "absolute", width: "500px", height: "500px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}22 0%, transparent 70%)`, top: "-150px", left: "-150px", pointerEvents: "none" }} />
          <div style={{ position: "absolute", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.terracotta}18 0%, transparent 70%)`, bottom: "-100px", right: "10%", pointerEvents: "none" }} />

          <main className="two-col" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", alignItems: "center", gap: "60px", maxWidth: "1280px", margin: "0 auto", position: "relative" }}>
            <div>
              <div className="anim-fadeUp" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: `${theme.forest}10`, border: `1px solid ${theme.forest}30`, borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, color: theme.forest, letterSpacing: "0.5px", marginBottom: "28px", animationDelay: "0.1s" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: theme.terracotta, animation: "pulse 2s ease-in-out infinite" }} />
                NOW IN BETA · AI FLOOR PLANNER
              </div>
              <h2 className="hero-title anim-fadeUp" style={{ fontSize: "5.2rem", lineHeight: 0.98, margin: 0, fontWeight: 500, fontFamily: fontDisplay, letterSpacing: "-2px", animationDelay: "0.2s" }}>
                Design <br /><em style={{ fontStyle: "italic", fontWeight: 400 }}>without</em> <br /><span className="shimmer-text">limits.</span>
              </h2>
              <p className="anim-fadeUp" style={{ maxWidth: "460px", color: theme.muted, marginTop: "28px", lineHeight: 1.65, fontSize: "1.08rem", animationDelay: "0.35s" }}>
                The AI-driven floor planner and home decoration studio for the next generation of homeowners. Sketch. Style.{" "}
                <em style={{ color: theme.terracotta, fontStyle: "normal", fontWeight: 600 }}>Ship your dream home.</em>
              </p>
              <div className="anim-fadeUp" style={{ marginTop: "36px", display: "flex", gap: "14px", alignItems: "center", animationDelay: "0.5s" }}>
                <button className="planora-btn" onClick={() => setPage("signup")} style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: "#faf5ec", border: "none", padding: "16px 32px", borderRadius: "999px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", boxShadow: `0 14px 32px ${theme.forest}50`, fontFamily: fontBody }}>
                  Start designing — Free
                </button>
                <button className="planora-btn" onClick={() => setPage("login")} style={{ background: "transparent", color: theme.ink, border: "none", padding: "16px 20px", fontSize: "1rem", fontWeight: 500, cursor: "pointer", fontFamily: fontBody, display: "flex", alignItems: "center", gap: "8px" }}>
                  Watch demo <span style={{ fontSize: "1.2rem" }}>→</span>
                </button>
              </div>
              <div className="anim-fadeUp" style={{ marginTop: "48px", display: "flex", gap: "32px", animationDelay: "0.65s", flexWrap: "wrap" }}>
                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>Free</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Forever · no credit card</div></div>
                <div style={{ width: "1px", background: theme.line }} />
                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>You</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Set every dimension</div></div>
                <div style={{ width: "1px", background: theme.line }} />
                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>AI</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Renders the visual</div></div>
              </div>
            </div>

            {/* Visual panel */}
            <div
              className="anim-scaleIn"
              style={{
                aspectRatio: "1/1",
                background: `linear-gradient(160deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`,
                borderRadius: "28px", display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative", overflow: "hidden",
                boxShadow: `0 40px 80px ${theme.forest}40, 0 0 0 1px ${theme.forest}20`,
                animationDelay: "0.3s",
              }}
            >
              <div style={{ position: "absolute", width: "80%", height: "80%", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}30 0%, transparent 60%)`, top: "10%", left: "10%", animation: "pulse 4s ease-in-out infinite" }} />
              <svg viewBox="0 0 400 400" style={{ width: "85%", height: "85%", position: "relative", zIndex: 1 }}>
                <rect x="40" y="40" width="320" height="320" fill="none" stroke={theme.gold} strokeWidth="2.5" className="floor-line" />
                <line x1="40" y1="180" x2="220" y2="180" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "0.5s" }} />
                <line x1="220" y1="40" x2="220" y2="280" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "0.9s" }} />
                <line x1="220" y1="280" x2="360" y2="280" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "1.3s" }} />
                <rect x="60" y="60" width="50" height="6" fill={theme.terracotta} className="anim-fadeIn" style={{ animationDelay: "2s" }} />
                <rect x="300" y="354" width="50" height="6" fill={theme.terracotta} className="anim-fadeIn" style={{ animationDelay: "2.2s" }} />
                <circle cx="290" cy="120" r="35" fill="none" stroke={theme.gold} strokeWidth="2" className="anim-scaleIn" style={{ animationDelay: "2.4s", transformOrigin: "290px 120px" }} />
                <text x="120" y="115" fill="#faf5ec" fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.6s" }}>LIVING</text>
                <text x="120" y="245" fill="#faf5ec" fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.7s" }}>BEDROOM</text>
                <text x="280" y="200" fill="#faf5ec" fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.8s" }}>KITCHEN</text>
                <text x="280" y="325" fill="#faf5ec" fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.9s" }}>BATH</text>
              </svg>
              <div className="anim-float" style={{ position: "absolute", top: "24px", right: "24px", background: "rgba(250,245,236,0.95)", color: theme.ink, padding: "10px 16px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80" }} />
                Live preview
              </div>
            </div>
          </main>
        </section>

        {/* MARQUEE */}
        <section style={{ padding: "24px 0", background: theme.ink, color: "#faf5ec", overflow: "hidden", borderTop: `1px solid ${theme.forest}`, borderBottom: `1px solid ${theme.forest}` }}>
          <div className="marquee-track">
            {[...marqueeItems, ...marqueeItems, ...marqueeItems].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", padding: "0 36px", fontSize: "1.4rem", fontFamily: fontDisplay, fontStyle: "italic", fontWeight: 400, opacity: 0.85 }}>
                {item}<span style={{ marginLeft: "36px", color: theme.terracotta, fontSize: "1.8rem" }}>✦</span>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" style={{ padding: "120px 48px", maxWidth: "1280px", margin: "0 auto" }}>
          <div className="scroll-reveal" style={{ textAlign: "center", marginBottom: "72px" }}>
            <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "16px" }}>✦ WHAT YOU GET</div>
            <h2 style={{ fontSize: "3.2rem", fontFamily: fontDisplay, fontWeight: 500, margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>
              Every tool your home <br /><em style={{ fontStyle: "italic", color: theme.terracotta }}>deserves.</em>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
            {features.map((f, i) => (
              <div
                key={i}
                className="glass-card planora-card scroll-reveal"
                style={{ ...glassCard({ padding: "36px 32px", borderRadius: "20px", position: "relative", overflow: "hidden", transitionDelay: `${i * 0.08}s` }) }}
              >
                <div style={{ width: "56px", height: "56px", borderRadius: "14px", background: `linear-gradient(135deg, ${theme.forest}15 0%, ${theme.terracotta}15 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", color: theme.forest, marginBottom: "20px" }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.25rem", margin: "0 0 10px", fontFamily: fontDisplay, fontWeight: 600 }}>{f.title}</h3>
                <p style={{ color: theme.muted, lineHeight: 1.6, margin: 0, fontSize: "0.94rem" }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" style={{ padding: "120px 48px", background: darkMode ? `rgba(255,255,255,0.02)` : `rgba(20,17,15,0.02)`, borderTop: `1px solid ${theme.line}`, borderBottom: `1px solid ${theme.line}` }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
            <div className="scroll-reveal" style={{ textAlign: "center", marginBottom: "72px" }}>
              <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "16px" }}>✦ HOW IT WORKS</div>
              <h2 style={{ fontSize: "3.2rem", fontFamily: fontDisplay, fontWeight: 500, margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>
                From blank page <br /> to blueprint in <em style={{ fontStyle: "italic", color: theme.terracotta }}>three steps.</em>
              </h2>
            </div>
            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "32px" }}>
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="glass-card planora-card scroll-reveal"
                  style={{ ...glassCard({ padding: "40px 32px", borderRadius: "20px", transitionDelay: `${i * 0.12}s` }) }}
                >
                  <div style={{ fontSize: "4rem", fontFamily: fontDisplay, fontWeight: 500, fontStyle: "italic", color: theme.terracotta, lineHeight: 1, marginBottom: "20px", opacity: 0.9 }}>{s.n}</div>
                  <h3 style={{ fontSize: "1.35rem", margin: "0 0 10px", fontFamily: fontDisplay, fontWeight: 600 }}>{s.title}</h3>
                  <p style={{ color: theme.muted, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section style={{ padding: "60px 48px 120px" }}>
          <div
            className="scroll-reveal-scale grain"
            style={{
              maxWidth: "1280px", margin: "0 auto",
              background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 50%, ${theme.plum} 100%)`,
              borderRadius: "32px", padding: "96px 48px",
              textAlign: "center", position: "relative", overflow: "hidden",
            }}
          >
            <svg viewBox="0 0 1200 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.08 }}>
              <rect x="80" y="80" width="240" height="240" fill="none" stroke={theme.gold} strokeWidth="2" />
              <rect x="880" y="80" width="240" height="240" fill="none" stroke={theme.gold} strokeWidth="2" />
              <line x1="80" y1="200" x2="200" y2="200" stroke={theme.gold} strokeWidth="2" />
              <line x1="1000" y1="200" x2="1120" y2="200" stroke={theme.gold} strokeWidth="2" />
              <line x1="880" y1="200" x2="1120" y2="200" stroke={theme.gold} strokeWidth="2" />
              <line x1="200" y1="80" x2="200" y2="320" stroke={theme.gold} strokeWidth="2" />
            </svg>
            <div style={{ position: "relative", zIndex: 1 }}>
              <h2 style={{ fontSize: "3.8rem", fontFamily: fontDisplay, fontWeight: 500, color: "#faf5ec", margin: "0 0 20px", lineHeight: 1.05, letterSpacing: "-1px" }}>
                Your dream home is <br /><em style={{ fontStyle: "italic", color: theme.gold }}>one click away.</em>
              </h2>
              <p style={{ color: "rgba(250,245,236,0.8)", fontSize: "1.1rem", maxWidth: "520px", margin: "0 auto 40px", lineHeight: 1.6 }}>
                Join thousands of homeowners designing their perfect space with Planora. No credit card, no commitment — just pure creation.
              </p>
              <button
                className="planora-btn"
                onClick={() => setPage("signup")}
                style={{ background: "rgba(250,245,236,0.95)", color: theme.ink, border: "none", padding: "18px 40px", borderRadius: "999px", fontSize: "1.05rem", fontWeight: 600, cursor: "pointer", boxShadow: `0 20px 50px rgba(20,17,15,0.5)`, fontFamily: fontBody }}
              >
                Start designing free →
              </button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer
          style={{
            padding: "40px 48px",
            borderTop: `1px solid ${theme.line}`,
            background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(20,17,15,0.02)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width="22" height="22" viewBox="0 0 40 40">
              <rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" />
              <line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" />
              <line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" />
              <circle cx="30" cy="12" r="3" fill={theme.terracotta} />
            </svg>
            <span style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: "1rem" }}>Planora</span>
            <span style={{ color: theme.muted, fontSize: "0.85rem", marginLeft: "12px" }}>© {new Date().getFullYear()} — Designed for dreamers.</span>
          </div>
          <div style={{ display: "flex", gap: "24px", fontSize: "0.85rem", color: theme.muted }}>
            <a href="#" className="planora-link" style={{ color: "inherit", textDecoration: "none" }}>Privacy</a>
            <a href="#" className="planora-link" style={{ color: "inherit", textDecoration: "none" }}>Terms</a>
            <a href="#" className="planora-link" style={{ color: "inherit", textDecoration: "none" }}>Contact</a>
          </div>
        </footer>
      </div>
    );
  }

  // =====================================================
  // GENERATOR PAGE
  // =====================================================
  return (
    <div
      className="anim-fadeIn"
      style={{
        minHeight: "100vh",
        background: darkMode
          ? `linear-gradient(160deg, #0d0b0a 0%, #13100e 50%, #1a0f15 100%)`
          : `linear-gradient(160deg, #f0ebe0 0%, #faf5ec 50%, #f5f0e8 100%)`,
        fontFamily: fontBody,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Background blobs */}
      <div style={{ position: "fixed", width: "600px", height: "600px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.forest}15 0%, transparent 70%)`, top: "-200px", right: "-200px", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}10 0%, transparent 70%)`, bottom: "-100px", left: "5%", pointerEvents: "none", zIndex: 0 }} />

      {/* FULL-WIDTH STICKY HEADER */}
      <AppHeader subtitle="Studio" />

      {/* CONTENT */}
      <div style={{ padding: "40px 48px 80px", position: "relative", zIndex: 1 }}>
        {/* WELCOME HEADING */}
        <div className="anim-fadeUp" style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "10px" }}>✦ YOUR STUDIO</div>
          <h2 style={{ fontSize: "2.6rem", margin: 0, fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-1px", lineHeight: 1.1 }}>
            Let's build <em style={{ fontStyle: "italic", color: theme.terracotta }}>something beautiful.</em>
          </h2>
        </div>

        {/* PROFILE SUMMARY */}
        <div
          className="anim-fadeUp grain"
          style={{
            background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`,
            padding: "32px 36px", borderRadius: "20px",
            color: "#faf5ec", marginBottom: "28px",
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "28px",
            boxShadow: `0 20px 50px ${theme.forest}30`,
            animationDelay: "0.15s", position: "relative", overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", width: "300px", height: "300px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}25 0%, transparent 70%)`, top: "-100px", right: "-60px", pointerEvents: "none" }} />
          {[
            { label: "HOUSE TYPE", value: houseType, cap: true },
            { label: "STYLE", value: style, cap: true },
            { label: "BEDROOMS", value: bedrooms },
            { label: "BUDGET", value: budget },
          ].map((item, i) => (
            <div key={i} style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: "0.68rem", letterSpacing: "1.5px", opacity: 0.7, fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 500, fontFamily: fontDisplay, marginTop: "6px", textTransform: item.cap ? "capitalize" : "none", color: item.value ? "#faf5ec" : "rgba(250,245,236,0.4)" }}>
                {item.value || "—"}
              </div>
            </div>
          ))}
        </div>

        {/* GENERATOR PANEL */}
        <div
          className="anim-fadeUp glass-card"
          style={{ ...glassCard({ padding: "36px", borderRadius: "20px", animationDelay: "0.25s" }) }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.4rem", fontFamily: fontDisplay, fontWeight: 600 }}>Design Generator</h3>
              <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: "0.9rem" }}>Hit generate and watch your layout come to life.</p>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                className="planora-btn"
                onClick={generateFloorPlan}
                disabled={loadingPlan}
                style={{
                  background: loadingPlan
                    ? theme.glass
                    : `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`,
                  color: loadingPlan ? theme.muted : "#faf5ec",
                  padding: "14px 28px",
                  cursor: loadingPlan ? "wait" : "pointer",
                  border: loadingPlan ? `1px solid ${theme.glassBorder}` : "none",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontFamily: fontBody,
                  fontSize: "0.95rem",
                  boxShadow: loadingPlan ? "none" : `0 12px 28px ${theme.forest}40`,
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  backdropFilter: loadingPlan ? "blur(10px)" : "none",
                  WebkitBackdropFilter: loadingPlan ? "blur(10px)" : "none",
                }}
              >
                {loadingPlan ? (
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        width: "14px",
                        height: "14px",
                        border: `2px solid ${theme.muted}40`,
                        borderTop: `2px solid ${theme.terracotta}`,
                        borderRadius: "50%",
                        animation: "rotateSlow 0.8s linear infinite",
                      }}
                    />
                    Generating…
                  </>
                ) : (
                  "✦ Generate Design"
                )}
              </button>

              {generatedFloors.length > 0 && !loadingPlan && (
                <button
                  className="planora-btn"
                  onClick={saveDesign}
                  style={{
                    background: `linear-gradient(135deg, ${theme.gold} 0%, #b8870a 100%)`,
                    color: theme.ink, padding: "14px 24px", border: "none",
                    borderRadius: "999px", cursor: "pointer", fontWeight: 600,
                    fontFamily: fontBody, fontSize: "0.95rem",
                    boxShadow: `0 10px 24px ${theme.gold}40`,
                  }}
                >
                  ⬡ Save Design
                </button>
              )}
            </div>
          </div>

          {/* ROOM SIZES INPUT — user-defined dimensions per room */}
          <div
            style={{
              marginTop: "8px",
              marginBottom: "26px",
              padding: "26px",
              borderRadius: "18px",
              border: `1px solid ${theme.glassBorder}`,
              background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.55)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ flex: 1, minWidth: "240px" }}>
                <div style={{ fontSize: "0.7rem", color: theme.terracotta, letterSpacing: "1.5px", fontWeight: 700 }}>
                  ✦ TUNE YOUR ROOMS
                </div>
                <div style={{ fontSize: "1.05rem", fontFamily: fontDisplay, fontWeight: 500, color: theme.ink, marginTop: "6px" }}>
                  Set the size of every room — in feet.
                </div>
                <div style={{ fontSize: "0.85rem", color: theme.muted, marginTop: "4px", lineHeight: 1.5 }}>
                  Not sure? Click <strong style={{ color: theme.terracotta }}>Suggest</strong> on any row and we'll fill in standard architect-approved sizes.
                  {(() => {
                    const total = customRooms.reduce((acc, r) => {
                      const w = Number(r.width) || 0;
                      const h = Number(r.height) || 0;
                      return acc + w * h;
                    }, 0);
                    return total > 0 ? (
                      <> Current total: <strong style={{ color: theme.ink }}>{total.toLocaleString()} sq.ft</strong>.</>
                    ) : null;
                  })()}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={fillAllSuggested}
                  title="Fill every empty size with a suggested default"
                  style={{
                    background: `${theme.gold}25`,
                    color: darkMode ? theme.gold : "#8b6f0a",
                    border: `1px solid ${theme.gold}50`,
                    borderRadius: "999px",
                    padding: "9px 16px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    fontFamily: fontBody,
                  }}
                >
                  ✦ Suggest all sizes
                </button>
                <button
                  type="button"
                  onClick={addCustomRoom}
                  style={{
                    background: theme.glass,
                    color: theme.ink,
                    border: `1px solid ${theme.glassBorder}`,
                    borderRadius: "999px",
                    padding: "9px 16px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    fontFamily: fontBody,
                  }}
                >
                  + Add Room
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {customRooms.map((r, idx) => {
                const hint = sizeHintFor(r.name);
                const isBedroom = /bedroom/i.test(r.name || "");
                return (
                  <div
                    key={`cr-${idx}`}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.5)",
                      border: `1px solid ${theme.glassBorder}`,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(160px, 2fr) 1fr 1fr auto auto",
                        gap: "10px",
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        placeholder={isBedroom ? "Bedroom name" : "Room name (e.g. Kitchen)"}
                        value={r.name}
                        onChange={(e) => updateCustomRoom(idx, "name", e.target.value)}
                        className="planora-input"
                        style={{ ...inputStyle, padding: "10px 14px", fontSize: "0.9rem" }}
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Width ft"
                        value={r.width}
                        onChange={(e) => updateCustomRoom(idx, "width", e.target.value)}
                        className="planora-input"
                        style={{ ...inputStyle, padding: "10px 14px", fontSize: "0.9rem" }}
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Height ft"
                        value={r.height}
                        onChange={(e) => updateCustomRoom(idx, "height", e.target.value)}
                        className="planora-input"
                        style={{ ...inputStyle, padding: "10px 14px", fontSize: "0.9rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => applySuggestedSize(idx)}
                        title="Use the suggested size for this room"
                        style={{
                          background: `${theme.terracotta}18`,
                          color: theme.terracotta,
                          border: `1px solid ${theme.terracotta}40`,
                          borderRadius: "10px",
                          padding: "8px 14px",
                          height: "38px",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "0.78rem",
                          fontFamily: fontBody,
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✦ Suggest
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustomRoom(idx)}
                        title="Remove this room"
                        style={{
                          background: "transparent",
                          color: theme.muted,
                          border: `1px solid ${theme.glassBorder}`,
                          borderRadius: "10px",
                          width: "38px",
                          height: "38px",
                          cursor: "pointer",
                          fontSize: "1.1rem",
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {hint && (
                      <div style={{ fontSize: "0.75rem", color: theme.muted, marginTop: "8px", paddingLeft: "4px" }}>
                        💡 Suggested for <span style={{ textTransform: "capitalize", color: theme.ink, fontWeight: 500 }}>{r.name || "this room"}</span>: {hint.text}
                      </div>
                    )}
                  </div>
                );
              })}
              {customRooms.length === 0 && (
                <div style={{ fontSize: "0.85rem", color: theme.muted, fontStyle: "italic", padding: "12px 0" }}>
                  No rooms yet. Click <strong style={{ color: theme.ink }}>+ Add Room</strong> to start, or set bedrooms in onboarding to auto-add them.
                </div>
              )}
            </div>
          </div>

          {/* Empty state */}
          {generatedFloors.length === 0 && !loadingPlan && (
            <div
              className="glass-card"
              style={{
                padding: "60px 20px", textAlign: "center",
                border: `2px dashed ${theme.glassBorder}`,
                borderRadius: "16px",
                background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.4)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontSize: "2.4rem", marginBottom: "12px", opacity: 0.5 }}>✦</div>
              <p style={{ color: theme.muted, margin: 0, fontSize: "0.95rem" }}>
                No rooms yet. Click <strong style={{ color: theme.ink }}>Generate Design</strong> to create your layout.
              </p>
            </div>
          )}

          {/* Loading state */}
          {loadingPlan && (
            <div
              className="glass-card anim-fadeUp"
              style={{
                padding: "64px 20px",
                textAlign: "center",
                border: `2px dashed ${theme.terracotta}40`,
                borderRadius: "16px",
                background: darkMode
                  ? `rgba(232,114,88,0.06)`
                  : `rgba(200,85,61,0.04)`,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  width: "280px",
                  height: "280px",
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${theme.terracotta}20 0%, transparent 70%)`,
                  top: "-80px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "relative", zIndex: 1 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "48px",
                    height: "48px",
                    border: `3px solid ${theme.terracotta}25`,
                    borderTop: `3px solid ${theme.terracotta}`,
                    borderRadius: "50%",
                    animation: "rotateSlow 1s linear infinite",
                    marginBottom: "18px",
                  }}
                />
                <p
                  style={{
                    color: theme.terracotta,
                    margin: 0,
                    fontSize: "1rem",
                    fontWeight: 600,
                    fontFamily: fontDisplay,
                    letterSpacing: "-0.3px",
                  }}
                >
                  AI is designing your floor plan…
                </p>
                <p style={{ color: theme.muted, margin: "8px 0 0", fontSize: "0.85rem" }}>
                  This usually takes 5–10 seconds
                </p>
              </div>
            </div>
          )}

          {/* Floor plan results — real dimensioned SVG layout */}
          {generatedFloors.length > 0 && !loadingPlan && (
            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: theme.muted,
                  letterSpacing: "1.5px",
                  fontWeight: 600,
                  marginBottom: "22px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: "#4ade80",
                    display: "inline-block",
                    boxShadow: "0 0 12px #4ade80",
                  }}
                />
                YOUR LAYOUT · {generatedFloors.length} FLOOR{generatedFloors.length > 1 ? "S" : ""} ·{" "}
                {generatedFloors.reduce((acc, f) => acc + (f.rooms?.length || 0), 0)} ROOMS
              </div>

              {/* AI-GENERATED LAYOUT IMAGE (free, via Pollinations.ai) */}
              {aiImageUrl && (
                <div
                  className="anim-fadeUp glass-card"
                  style={{
                    ...glassCard({ borderRadius: "16px" }),
                    padding: "20px",
                    marginBottom: "26px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <div style={{ fontSize: "0.7rem", color: theme.terracotta, letterSpacing: "1.5px", fontWeight: 700 }}>
                        ✦ AI LAYOUT VISUALIZATION
                      </div>
                      <div style={{ fontSize: "0.85rem", color: theme.muted, marginTop: "4px" }}>
                        Generated by AI based on your design preferences
                      </div>
                    </div>
                    <a
                      href={aiImageUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: "0.78rem",
                        color: theme.terracotta,
                        textDecoration: "none",
                        fontWeight: 600,
                        border: `1px solid ${theme.terracotta}40`,
                        padding: "6px 14px",
                        borderRadius: "999px",
                      }}
                    >
                      Open full size ↗
                    </a>
                  </div>
                  <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", background: darkMode ? "#1a1614" : "#ece6d8", minHeight: "240px" }}>
                    {loadingImage && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted, fontSize: "0.85rem", gap: "10px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: "16px",
                            height: "16px",
                            border: `2px solid ${theme.muted}40`,
                            borderTop: `2px solid ${theme.terracotta}`,
                            borderRadius: "50%",
                            animation: "rotateSlow 0.8s linear infinite",
                          }}
                        />
                        Rendering AI image…
                      </div>
                    )}
                    <img
                      src={aiImageUrl}
                      alt="AI-generated floor plan layout"
                      onLoad={() => setLoadingImage(false)}
                      onError={() => setLoadingImage(false)}
                      style={{
                        display: "block",
                        width: "100%",
                        height: "auto",
                        opacity: loadingImage ? 0 : 1,
                        transition: "opacity 0.5s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              {generatedFloors.map((floor, i) => {
                // --- SVG geometry ---
                const pad = 24;
                const W = floor.width || 40;
                const H = floor.height || 30;
                const scale = 16; // px per foot — controls on-screen size
                const svgW = W * scale + pad * 2;
                const svgH = H * scale + pad * 2;
                const roomColors = [theme.terracotta, theme.forest, theme.gold, theme.plum];
                const totalSqft = Math.round(W * H);

                return (
                  <div
                    key={`floor-${i}-${floor.name}`}
                    className="anim-fadeUp"
                    style={{ marginBottom: "36px", animationDelay: `${i * 0.08}s` }}
                  >
                    {/* Floor heading */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          color: "#faf5ec",
                          flexShrink: 0,
                          boxShadow: `0 6px 16px ${theme.terracotta}40`,
                        }}
                      >
                        {i + 1}
                      </div>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "1.15rem",
                          fontFamily: fontDisplay,
                          fontWeight: 600,
                          color: theme.ink,
                          letterSpacing: "-0.3px",
                        }}
                      >
                        {floor.name}
                      </h3>
                      <span
                        className="glass-card"
                        style={{
                          fontSize: "0.72rem",
                          color: theme.muted,
                          background: theme.glass,
                          border: `1px solid ${theme.glassBorder}`,
                          padding: "4px 12px",
                          borderRadius: "999px",
                          fontWeight: 600,
                          letterSpacing: "0.3px",
                        }}
                      >
                        {floor.rooms?.length || 0} rooms
                      </span>
                      <span
                        className="glass-card"
                        style={{
                          fontSize: "0.72rem",
                          color: theme.muted,
                          background: theme.glass,
                          border: `1px solid ${theme.glassBorder}`,
                          padding: "4px 12px",
                          borderRadius: "999px",
                          fontWeight: 600,
                          letterSpacing: "0.3px",
                        }}
                      >
                        {W}′ × {H}′ · {totalSqft} sq.ft
                      </span>
                    </div>

                    {/* SVG floor plan */}
                    <div
                      className="glass-card"
                      style={{
                        ...glassCard({ borderRadius: "16px", padding: "24px" }),
                        overflow: "auto",
                      }}
                    >
                      <svg
                        viewBox={`0 0 ${svgW} ${svgH}`}
                        style={{
                          width: "100%",
                          maxWidth: `${svgW}px`,
                          height: "auto",
                          display: "block",
                          margin: "0 auto",
                        }}
                      >
                        <defs>
                          {roomColors.map((c, k) => (
                            <linearGradient key={k} id={`roomGrad-${i}-${k}`} x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor={c} stopOpacity={darkMode ? "0.28" : "0.22"} />
                              <stop offset="100%" stopColor={c} stopOpacity={darkMode ? "0.08" : "0.06"} />
                            </linearGradient>
                          ))}
                          <pattern id={`grid-${i}`} width={scale} height={scale} patternUnits="userSpaceOnUse">
                            <path
                              d={`M ${scale} 0 L 0 0 0 ${scale}`}
                              fill="none"
                              stroke={theme.muted}
                              strokeWidth="0.5"
                              strokeOpacity="0.15"
                            />
                          </pattern>
                        </defs>

                        {/* Grid background */}
                        <rect
                          x={pad}
                          y={pad}
                          width={W * scale}
                          height={H * scale}
                          fill={`url(#grid-${i})`}
                        />

                        {/* Outer walls */}
                        <rect
                          x={pad}
                          y={pad}
                          width={W * scale}
                          height={H * scale}
                          fill="none"
                          stroke={theme.ink}
                          strokeWidth="4"
                          strokeLinejoin="round"
                        />

                        {/* Rooms */}
                        {(floor.rooms || []).map((r, j) => {
                          const rx = pad + (r.x || 0) * scale;
                          const ry = pad + (r.y || 0) * scale;
                          const rw = (r.width || 10) * scale;
                          const rh = (r.height || 10) * scale;
                          const colorIdx = j % roomColors.length;
                          const accent = roomColors[colorIdx];
                          const cx = rx + rw / 2;
                          const cy = ry + rh / 2;
                          // Pick a font size that fits inside the room
                          const minDim = Math.min(rw, rh);
                          const nameSize = Math.max(10, Math.min(15, minDim / 7));
                          const dimSize = Math.max(8, Math.min(11, minDim / 10));

                          return (
                            <g key={`room-${i}-${j}`} className="anim-scaleIn" style={{ animationDelay: `${(i * 0.08) + (j * 0.05)}s`, transformOrigin: `${cx}px ${cy}px` }}>
                              <rect
                                x={rx}
                                y={ry}
                                width={rw}
                                height={rh}
                                fill={`url(#roomGrad-${i}-${colorIdx})`}
                                stroke={accent}
                                strokeWidth="2"
                                rx="4"
                                ry="4"
                              />
                              <text
                                x={cx}
                                y={cy - 2}
                                textAnchor="middle"
                                fontFamily={fontDisplay}
                                fontSize={nameSize}
                                fontWeight="600"
                                fill={theme.ink}
                                style={{ textTransform: "capitalize" }}
                              >
                                {r.name}
                              </text>
                              <text
                                x={cx}
                                y={cy + dimSize + 4}
                                textAnchor="middle"
                                fontFamily={fontBody}
                                fontSize={dimSize}
                                fill={theme.muted}
                              >
                                {r.width}′ × {r.height}′
                              </text>
                            </g>
                          );
                        })}

                        {/* Scale ruler — top */}
                        <g>
                          <line x1={pad} y1={pad - 10} x2={pad + W * scale} y2={pad - 10} stroke={theme.muted} strokeWidth="1" />
                          <line x1={pad} y1={pad - 14} x2={pad} y2={pad - 6} stroke={theme.muted} strokeWidth="1" />
                          <line x1={pad + W * scale} y1={pad - 14} x2={pad + W * scale} y2={pad - 6} stroke={theme.muted} strokeWidth="1" />
                          <text x={pad + (W * scale) / 2} y={pad - 14} textAnchor="middle" fontFamily={fontBody} fontSize="10" fill={theme.muted}>
                            {W}′
                          </text>
                        </g>
                        {/* Scale ruler — left */}
                        <g>
                          <line x1={pad - 10} y1={pad} x2={pad - 10} y2={pad + H * scale} stroke={theme.muted} strokeWidth="1" />
                          <line x1={pad - 14} y1={pad} x2={pad - 6} y2={pad} stroke={theme.muted} strokeWidth="1" />
                          <line x1={pad - 14} y1={pad + H * scale} x2={pad - 6} y2={pad + H * scale} stroke={theme.muted} strokeWidth="1" />
                          <text x={pad - 14} y={pad + (H * scale) / 2} textAnchor="middle" fontFamily={fontBody} fontSize="10" fill={theme.muted} transform={`rotate(-90 ${pad - 14} ${pad + (H * scale) / 2})`}>
                            {H}′
                          </text>
                        </g>
                      </svg>
                    </div>

                    {/* Room legend chips below the plan */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "14px",
                      }}
                    >
                      {(floor.rooms || []).map((r, j) => {
                        const accent = roomColors[j % roomColors.length];
                        const sqft = Math.round((r.width || 0) * (r.height || 0));
                        return (
                          <div
                            key={`chip-${i}-${j}`}
                            className="glass-card"
                            style={{
                              padding: "8px 14px",
                              borderRadius: "999px",
                              border: `1px solid ${accent}50`,
                              background: theme.glass,
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "0.8rem",
                              color: theme.ink,
                              fontWeight: 500,
                              textTransform: "capitalize",
                            }}
                          >
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: accent,
                                boxShadow: `0 0 6px ${accent}80`,
                              }}
                            />
                            {r.name}
                            <span style={{ color: theme.muted, fontSize: "0.72rem", fontWeight: 400 }}>
                              · {sqft} sq.ft
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AI Suggestion */}
          {suggestion && (
            <div
              className="anim-fadeUp glass-card"
              style={{
                marginTop: "28px", padding: "20px 24px",
                ...glassCard({ borderRadius: "14px" }),
                background: darkMode ? `rgba(200,85,61,0.1)` : `rgba(200,85,61,0.06)`,
                border: `1px solid ${theme.terracotta}30`,
                display: "flex", alignItems: "flex-start", gap: "14px",
              }}
            >
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", flexShrink: 0, fontWeight: 700 }}>✦</div>
              <div>
                <div style={{ fontSize: "0.72rem", color: theme.terracotta, letterSpacing: "1.5px", fontWeight: 700, marginBottom: "4px" }}>AI SUGGESTION</div>
                <p style={{ margin: 0, color: theme.ink, lineHeight: 1.5, fontSize: "0.95rem" }}>{suggestion}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
