import { useState, useEffect } from "react";
import { auth, signInWithGoogle, logout } from "./firebase";
import {
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
} from "firebase/auth";
import jsPDF from "jspdf";
import "jspdf-autotable";

function App() {
    const [user, setUser] = useState(null);
    const [page, setPage] = useState("home");
    const [saveCount, setSaveCount] = useState(0);
    const [savedDesigns, setSavedDesigns] = useState([]);

    // Auth form state
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [authLoading, setAuthLoading] = useState(false);

    // Dark mode
    const [darkMode, setDarkMode] = useState(false);

    // Onboarding / Layout preferences
    const [houseType, setHouseType] = useState("");
    const [style, setStyle] = useState("");
    const [bedrooms, setBedrooms] = useState("");
    const [budget, setBudget] = useState("");
    const [onboardingDone, setOnboardingDone] = useState(false);

    // Conditional detail fields
    const [numFloors, setNumFloors] = useState("");
    const [plotArea, setPlotArea] = useState("");
    const [floorNumber, setFloorNumber] = useState("");
    const [carpetArea, setCarpetArea] = useState("");
    const [hasBalcony, setHasBalcony] = useState("");
    const [hasGarden, setHasGarden] = useState("");
    const [hasParking, setHasParking] = useState("");
    const [propertyAge, setPropertyAge] = useState("");

    // Extra prefs
    const [description, setDescription] = useState("");
    const [blueprintFile, setBlueprintFile] = useState(null);

    // Generator
    const [floors, setFloors] = useState([]);
    const [suggestion, setSuggestion] = useState("");
    const [loadingPlan, setLoadingPlan] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                setPage((prev) =>
                    prev === "home" || prev === "login" || prev === "signup"
                        ? onboardingDone
                            ? "generator"
                            : "onboarding"
                        : prev
                );
            } else {
                setPage("home");
                setFloors([]);
                setSuggestion("");
            }
        });
        return () => unsubscribe();
        // eslint-disable-next-line
    }, []);

    const handleLogout = async () => {
        try {
            await logout();
        } catch (e) { }
        setPage("home");
    };

    // ---------- INJECT GLOBAL STYLES ----------
    useEffect(() => {
        if (document.getElementById("planora-global-styles")) return;
        const styleEl = document.createElement("style");
        styleEl.id = "planora-global-styles";
        styleEl.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@300;400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideInLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes slideInRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
      @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
      @keyframes drawLine { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
      @keyframes pulse { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
      @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      @keyframes rotateSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .anim-fadeUp { animation: fadeUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-fadeIn { animation: fadeIn 1s ease-out both; }
      .anim-slideLeft { animation: slideInLeft 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-slideRight { animation: slideInRight 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-scaleIn { animation: scaleIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
      .anim-float { animation: float 6s ease-in-out infinite; }
      .planora-btn { transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease, background 0.25s ease; }
      .planora-btn:hover { transform: translateY(-2px); }
      .planora-btn:active { transform: translateY(0); }
      .planora-card { transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s ease, border-color 0.25s ease; }
      .planora-card:hover { transform: translateY(-6px); }
      .planora-link { position: relative; transition: color 0.2s ease; }
      .planora-link::after { content: ''; position: absolute; left: 0; bottom: -2px; width: 100%; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: right; transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
      .planora-link:hover::after { transform: scaleX(1); transform-origin: left; }
      .planora-input { transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease; }
      .planora-input:focus { border-color: #c8553d !important; box-shadow: 0 0 0 4px rgba(200, 85, 61, 0.1); }
      .floor-line { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: drawLine 2.5s ease-out forwards; }
      .marquee-track { display: flex; width: max-content; animation: marquee 40s linear infinite; }
      .shimmer-text { background: linear-gradient(90deg, var(--shimmer-base, #14110f) 0%, #c8553d 50%, var(--shimmer-base, #14110f) 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 4s linear infinite; }
      .grain::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: 0.04; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
      @media (max-width: 900px) { .two-col { grid-template-columns: 1fr !important; } .hero-title { font-size: 3rem !important; } .big-pad { padding: 24px !important; } }
      .scroll-reveal { opacity: 0; transform: translateY(40px); transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); will-change: opacity, transform; }
      .scroll-reveal.revealed { opacity: 1; transform: translateY(0); }
      .scroll-reveal-left { opacity: 0; transform: translateX(-40px); transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
      .scroll-reveal-left.revealed { opacity: 1; transform: translateX(0); }
      .scroll-reveal-right { opacity: 0; transform: translateX(40px); transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
      .scroll-reveal-right.revealed { opacity: 1; transform: translateX(0); }
      .scroll-reveal-scale { opacity: 0; transform: scale(0.92); transition: opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
      .scroll-reveal-scale.revealed { opacity: 1; transform: scale(1); }
    `;
        document.head.appendChild(styleEl);
    }, []);

    const fontDisplay = "'Fraunces', Georgia, serif";
    const fontBody = "'Inter', -apple-system, Segoe UI, sans-serif";

    // ---------- SCROLL REVEAL ----------
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

    // ---------- DARK MODE ----------
    useEffect(() => {
        document.documentElement.style.setProperty("--shimmer-base", darkMode ? "#faf5ec" : "#14110f");
        document.body.style.background = darkMode ? "#0d0b0a" : "#faf5ec";
        document.body.style.color = darkMode ? "#faf5ec" : "#14110f";
    }, [darkMode]);

    const theme = darkMode
        ? {
            cream: "#0d0b0a", ivory: "#15120f", card: "#1c1815", ink: "#faf5ec",
            forest: "#5a8c6f", forestDeep: "#3d6350", terracotta: "#e87258",
            gold: "#e8b82c", plum: "#7d5168", sand: "#2a2520", muted: "#9a9086", line: "#2a2520",
        }
        : {
            cream: "#faf5ec", ivory: "#fffaf1", card: "#ffffff", ink: "#14110f",
            forest: "#1a3d2e", forestDeep: "#0f2a20", terracotta: "#c8553d",
            gold: "#d4a017", plum: "#4a2c3e", sand: "#e8dfd0", muted: "#7a7468", line: "#d9cfbe",
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

    // ---------- SAVE DESIGN ----------
    const saveDesign = () => {
        if (floors.length === 0) { alert("Generate a design first!"); return; }
        if (saveCount >= 10) { alert("Free limit reached! (10/10). Payment gateway coming soon."); return; }
        const totalRooms = floors.reduce((acc, f) => acc + f.rooms.length, 0);
        const newDesign = {
            id: Date.now(),
            name: `${style || "Custom"} ${houseType || "home"} #${saveCount + 1}`,
            houseType, style, bedrooms,
            rooms: floors.flatMap((f) => f.rooms),
            floors: [...floors],
            suggestion,
            savedAt: new Date().toLocaleDateString(),
        };
        setSavedDesigns((prev) => [newDesign, ...prev]);
        setSaveCount(saveCount + 1);
        alert(`Design Saved! (${saveCount + 1}/10 free slots used)`);
    };

    // ---------- GENERATE FLOOR PLAN ----------
    const generateFloorPlan = async () => {
        // 🔍 TRACER 1: Is the function even starting?
        console.log("🚀 generateFloorPlan started!");

        if (!houseType || !style) {
            console.log("❌ Missing houseType or style. Current values:", { houseType, style });
            alert("Please complete onboarding first!");
            setPage("onboarding");
            return;
        }

        try {
            setLoadingPlan(true);
            setFloors([]);
            setSuggestion("");

            const formData = {
                houseType,
                style,
                bedrooms,
                numFloors,
                plotArea,
                floorNumber,
                carpetArea,
                hasBalcony,
                hasGarden,
                hasParking,
                propertyAge,
                description,
                familySize: "Standard"
            };

            // 🔍 TRACER 2: What data are we actually sending?
            console.log("📤 Sending this data to Render:", formData);

            // --- SAFETY NET (TIMEOUT) START ---
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.log("⏱️ Request timed out after 60 seconds.");
            }, 120000);
            // --- SAFETY NET END ---

            const response = await fetch("https://planora-api-4faq.onrender.com/generate-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
                signal: controller.signal // Connect the timeout signal
            });

            clearTimeout(timeoutId); // Stop the timer if it works!

            // 🔍 TRACER 3: Did the server say anything?
            console.log("📥 Server responded with status:", response.status);

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Server error");
            }

            const data = await response.json();
            console.log("✅ AI Data Received:", data);

            const parsed = data.output;
            if (!parsed || !parsed.floors) throw new Error("Invalid AI data format");

            setFloors(parsed.floors);

            // Combine the AI advice with the stats for a professional look
            const totalRooms = parsed.floors.reduce((acc, f) => acc + (f.rooms?.length || 0), 0);
            const stats = `[${parsed.floors.length} Floors | ${totalRooms} Rooms] `;
            setSuggestion(stats + (parsed.architecturalAdvice || ""));
        } catch (err) {
            // 🔍 TRACER 4: Where did it crash?
            console.error("💥 CATASTROPHIC ERROR:", err);

            if (err.name === 'AbortError') {
                alert("The server is taking too long to wake up. Try again in 10 seconds.");
            } else {
                alert("Failed to generate plan: " + err.message);
            }
        } finally {
            setLoadingPlan(false);
            console.log("🏁 generateFloorPlan finished.");
        }
    };

    //download feature
    const downloadPDF = () => {
        const doc = new jsPDF();

        // Title
        doc.setFontSize(22);
        doc.text("Planora AI - Design Proposal", 20, 20);

        // Project Info
        doc.setFontSize(12);
        doc.text(`Project: ${style} ${houseType}`, 20, 30);
        doc.text(`Estimated Bedrooms: ${bedrooms}`, 20, 37);
        doc.line(20, 42, 190, 42); // Divider line

        // Floor Details Table
        // We use the 'floors' state that the AI just populated
        floors.forEach((floor, index) => {
            const startY = index === 0 ? 50 : doc.lastAutoTable.finalY + 20;

            doc.setFontSize(16);
            doc.text(floor.floorName || `Floor ${index + 1}`, 20, startY);

            const tableRows = floor.rooms.map(room => [
                room.name,
                room.dimensions || "N/A",
                room.description || ""
            ]);

            doc.autoTable({
                startY: startY + 5,
                head: [['Room Name', 'Estimated Dimensions', 'Features']],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [44, 62, 80] }, // Dark professional header
            });
        });

        // Add the AI Suggestion / Rationale at the end
        const finalY = doc.lastAutoTable.finalY + 15;
        doc.setFontSize(14);
        doc.text("Architectural Notes:", 20, finalY);
        doc.setFontSize(10);
        const splitSuggestion = doc.splitTextToSize(suggestion, 170);
        doc.text(splitSuggestion, 20, finalY + 10);

        // Save File
        doc.save(`Planora_${houseType}_Design.pdf`);
    };
    // ---------- SHARED STYLES ----------
    const inputStyle = {
        width: "100%", padding: "14px 16px", marginTop: "6px", marginBottom: "16px",
        background: theme.ivory, border: `1px solid ${theme.line}`, borderRadius: "10px",
        fontSize: "0.95rem", outline: "none", boxSizing: "border-box", color: theme.ink,
    };
    const labelStyle = { fontSize: "0.75rem", color: theme.muted, fontWeight: 600, letterSpacing: "0.6px" };

    // ---------- BRAND PANEL ----------
    const BrandPanel = ({ heading, sub }) => (
        <div style={{
            position: "relative",
            background: `linear-gradient(160deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`,
            padding: "48px", display: "flex", flexDirection: "column",
            justifyContent: "space-between", color: theme.cream, overflow: "hidden",
        }}>
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
                <h1 style={{ fontSize: "1.7rem", fontWeight: 700, letterSpacing: "-0.5px", margin: 0 }}>Planora</h1>
                <p style={{ marginTop: "6px", fontSize: "0.78rem", opacity: 0.8, letterSpacing: "1.5px" }}>FLOOR PLANS · INTERIORS · IDEAS</p>
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
                <h2 style={{ fontSize: "2.8rem", lineHeight: 1.1, margin: 0, fontWeight: 600 }}>{heading}</h2>
                <p style={{ marginTop: "20px", maxWidth: "380px", opacity: 0.85, lineHeight: 1.6 }}>{sub}</p>
            </div>
            <div style={{ position: "relative", zIndex: 1, fontSize: "0.78rem", opacity: 0.7 }}>© {new Date().getFullYear()} Planora Studio</div>
        </div>
    );

    // =====================================================
    // LOGIN PAGE
    // =====================================================
    if (page === "login" && !user) {
        return (
            <div className="anim-fadeIn" style={{ minHeight: "100vh", background: theme.cream, fontFamily: fontBody, color: theme.ink, display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <BrandPanel heading={<>Design the home <br /> you've imagined.</>} sub="Sign in to save your floor plans, mood boards, and interior styles — all in one place." />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
                    <div style={{ width: "100%", maxWidth: "400px" }}>
                        <button onClick={() => setPage("home")} style={{ background: "none", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.85rem", padding: 0, marginBottom: "32px" }}>← Back to home</button>
                        <h2 style={{ fontSize: "2.4rem", fontWeight: 500, margin: "0 0 10px 0", fontFamily: fontDisplay, letterSpacing: "-1px" }}>Welcome <em style={{ fontStyle: "italic", color: theme.terracotta }}>back</em></h2>
                        <p style={{ color: theme.muted, marginBottom: "32px", fontSize: "0.95rem" }}>Sign in to continue designing your space.</p>
                        <label style={labelStyle}>EMAIL</label>
                        <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
                        <label style={labelStyle}>PASSWORD</label>
                        <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
                        {authError && <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 12px" }}>{authError}</p>}
                        <button onClick={handleEmailLogin} disabled={authLoading} className="planora-btn" style={{ width: "100%", padding: "14px", background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: theme.cream, border: "none", borderRadius: "10px", fontSize: "0.95rem", fontWeight: 600, cursor: authLoading ? "wait" : "pointer", letterSpacing: "0.3px", marginTop: "8px", boxShadow: `0 10px 24px ${theme.forest}30` }}>
                            {authLoading ? "Signing in..." : "Sign in"}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", margin: "24px 0", color: theme.muted, fontSize: "0.75rem" }}>
                            <div style={{ flex: 1, height: "1px", background: theme.line }} /><span style={{ padding: "0 12px" }}>OR</span><div style={{ flex: 1, height: "1px", background: theme.line }} />
                        </div>
                        <button onClick={signInWithGoogle} style={{ width: "100%", padding: "13px", background: theme.card, color: theme.ink, border: `1px solid ${theme.line}`, borderRadius: "10px", fontSize: "0.95rem", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.8 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
                            Continue with Google
                        </button>
                        <p style={{ marginTop: "32px", textAlign: "center", color: theme.muted, fontSize: "0.88rem" }}>
                            Don't have an account?{" "}
                            <span onClick={() => { setAuthError(""); setPage("signup"); }} style={{ color: theme.terracotta, fontWeight: 600, cursor: "pointer" }}>Sign up</span>
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
            <div className="anim-fadeIn" style={{ minHeight: "100vh", background: theme.cream, fontFamily: fontBody, color: theme.ink, display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <BrandPanel heading={<>Start crafting <br /> your dream space.</>} sub="Create an account to generate floor plans, save your favorite styles, and design every room your way." />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
                    <div style={{ width: "100%", maxWidth: "400px" }}>
                        <button onClick={() => setPage("home")} style={{ background: "none", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.85rem", padding: 0, marginBottom: "32px" }}>← Back to home</button>
                        <h2 style={{ fontSize: "2.4rem", fontWeight: 500, margin: "0 0 10px 0", fontFamily: fontDisplay, letterSpacing: "-1px" }}>Create <em style={{ fontStyle: "italic", color: theme.terracotta }}>account</em></h2>
                        <p style={{ color: theme.muted, marginBottom: "28px", fontSize: "0.95rem" }}>Join Planora and design your home in minutes.</p>
                        <label style={labelStyle}>FULL NAME</label>
                        <input type="text" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
                        <label style={labelStyle}>EMAIL</label>
                        <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
                        <label style={labelStyle}>PASSWORD</label>
                        <input type="password" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
                        <label style={labelStyle}>CONFIRM PASSWORD</label>
                        <input type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
                        {authError && <p style={{ color: theme.terracotta, fontSize: "0.85rem", margin: "0 0 12px" }}>{authError}</p>}
                        <button onClick={handleSignUp} disabled={authLoading} className="planora-btn" style={{ width: "100%", padding: "14px", background: `linear-gradient(135deg, ${theme.terracotta} 0%, #a8412d 100%)`, color: theme.cream, border: "none", borderRadius: "10px", fontSize: "0.95rem", fontWeight: 600, cursor: authLoading ? "wait" : "pointer", letterSpacing: "0.3px", boxShadow: `0 8px 24px ${theme.terracotta}40` }}>
                            {authLoading ? "Creating account..." : "Create account"}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", margin: "22px 0", color: theme.muted, fontSize: "0.75rem" }}>
                            <div style={{ flex: 1, height: "1px", background: theme.line }} /><span style={{ padding: "0 12px" }}>OR</span><div style={{ flex: 1, height: "1px", background: theme.line }} />
                        </div>
                        <button onClick={signInWithGoogle} style={{ width: "100%", padding: "13px", background: theme.card, color: theme.ink, border: `1px solid ${theme.line}`, borderRadius: "10px", fontSize: "0.95rem", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.8 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
                            Continue with Google
                        </button>
                        <p style={{ marginTop: "28px", textAlign: "center", color: theme.muted, fontSize: "0.88rem" }}>
                            Already have an account?{" "}
                            <span onClick={() => { setAuthError(""); setPage("login"); }} style={{ color: theme.terracotta, fontWeight: 600, cursor: "pointer" }}>Sign in</span>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // =====================================================
    // ONBOARDING PAGE
    // =====================================================
    if (page === "onboarding" && user) {
        const iconProps = { width: 38, height: 38, viewBox: "0 0 40 40", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" };
        const houseTypes = [
            { id: "villa", label: "Villa", desc: "Spacious & luxurious", icon: (<svg {...iconProps}><path d="M6 34h28" /><path d="M8 34V16l12-8 12 8v18" /><path d="M12 34V20m4 14V20m4 14V20m4 14V20m4 14V20" /><path d="M6 16h28" /></svg>) },
            { id: "apartment", label: "Apartment", desc: "Urban & efficient", icon: (<svg {...iconProps}><rect x="9" y="5" width="22" height="30" rx="1" /><path d="M14 11h3M23 11h3M14 17h3M23 17h3M14 23h3M23 23h3" /><path d="M17 35v-6h6v6" /></svg>) },
            { id: "bungalow", label: "Bungalow", desc: "Single-storey comfort", icon: (<svg {...iconProps}><path d="M5 20l15-12 15 12" /><path d="M8 18v16h24V18" /><path d="M17 34v-8h6v8" /><path d="M26 12V7h3v8" /></svg>) },
            { id: "townhouse", label: "Townhouse", desc: "Multi-level living", icon: (<svg {...iconProps}><path d="M4 34h32" /><path d="M6 34V16l7-6 7 6v18" /><path d="M20 34V12l7-5 7 5v22" /><path d="M10 34v-8h6v8" /><path d="M25 34v-9h5v9" /></svg>) },
            { id: "studio", label: "Studio", desc: "Compact & open", icon: (<svg {...iconProps}><rect x="6" y="8" width="28" height="22" rx="1" /><path d="M6 24h28" /><path d="M11 24v-6a3 3 0 013-3h12a3 3 0 013 3v6" /><path d="M9 30v3M31 30v3" /></svg>) },
            { id: "duplex", label: "Duplex", desc: "Two-floor flexibility", icon: (<svg {...iconProps}><path d="M5 18l15-11 15 11" /><path d="M8 16v18h24V16" /><path d="M8 25h24" /><path d="M14 25v-5h5v5M25 34v-6h5v6" /></svg>) },
            { id: "others", label: "Others", desc: "Something different", icon: (<svg {...iconProps}><path d="M20 5v30M5 20h30" /><path d="M9 9l22 22M31 9L9 31" /><circle cx="20" cy="20" r="3" /></svg>) },
        ];
        const styles = [
            { id: "modern", label: "Modern", desc: "Clean lines, bold forms", icon: (<svg {...iconProps}><rect x="6" y="6" width="28" height="28" rx="1" /><path d="M6 16h28M16 6v28" /></svg>) },
            { id: "minimalist", label: "Minimalist", desc: "Less, but better", icon: (<svg {...iconProps}><circle cx="20" cy="20" r="13" /><path d="M20 13v14" /></svg>) },
            { id: "scandinavian", label: "Scandinavian", desc: "Light, warm, natural", icon: (<svg {...iconProps}><path d="M20 5v30" /><path d="M20 12l-5-5M20 12l5-5" /><path d="M20 20l-7-7M20 20l7-7" /><path d="M20 28l-5-5M20 28l5-5" /></svg>) },
            { id: "industrial", label: "Industrial", desc: "Raw & unfinished", icon: (<svg {...iconProps}><circle cx="20" cy="20" r="6" /><path d="M20 5v5M20 30v5M5 20h5M30 20h5M9 9l3.5 3.5M27.5 27.5L31 31M31 9l-3.5 3.5M12.5 27.5L9 31" /></svg>) },
            { id: "bohemian", label: "Bohemian", desc: "Eclectic & layered", icon: (<svg {...iconProps}><path d="M20 35V12" /><path d="M20 12c0-4 3-7 7-7 0 4-3 7-7 7z" /><path d="M20 18c0-3-2-5-5-5 0 3 2 5 5 5z" /><path d="M20 24c0-3 2-5 5-5 0 3-2 5-5 5z" /><path d="M20 30c0-3-2-5-5-5 0 3 2 5 5 5z" /></svg>) },
            { id: "traditional", label: "Traditional", desc: "Timeless elegance", icon: (<svg {...iconProps}><path d="M6 34h28" /><path d="M8 34V14h24v20" /><path d="M6 14l14-8 14 8" /><path d="M13 34V18M20 34V18M27 34V18" /></svg>) },
        ];
        const Card = ({ active, onClick, children }) => (
            <div onClick={onClick} className="planora-card" style={{ padding: "22px", borderRadius: "16px", background: active ? theme.ivory : theme.card, border: active ? `2px solid ${theme.terracotta}` : `1px solid ${theme.line}`, cursor: "pointer", boxShadow: active ? `0 16px 36px ${theme.terracotta}30` : "0 2px 8px rgba(20,17,15,0.04)", transform: active ? "translateY(-3px)" : "none" }}>
                {children}
            </div>
        );
        const canContinue = houseType && style;
        return (
            <div className="anim-fadeIn" style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${theme.cream} 0%, ${theme.ivory} 100%)`, fontFamily: fontBody, color: theme.ink, padding: "40px 48px 80px" }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "48px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <svg width="26" height="26" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" /><line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" /><line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" /><circle cx="30" cy="12" r="3" fill={theme.terracotta} /></svg>
                        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, fontFamily: fontDisplay }}>Planora</h1>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ color: theme.muted, fontSize: "0.9rem" }}>Hi, {user?.displayName || user?.email}</span>
                        <button className="planora-btn" onClick={() => setDarkMode(!darkMode)} style={{ width: "38px", height: "38px", borderRadius: "50%", background: theme.card, border: `1px solid ${theme.line}`, cursor: "pointer", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center", color: theme.ink }}>{darkMode ? "☀" : "☾"}</button>
                        <button className="planora-btn" onClick={handleLogout} style={{ background: "transparent", color: theme.ink, border: `1px solid ${theme.line}`, padding: "9px 18px", borderRadius: "999px", cursor: "pointer", fontSize: "0.85rem", fontFamily: fontBody }}>Logout</button>
                    </div>
                </header>

                <div style={{ maxWidth: "900px", margin: "0 auto 40px" }}>
                    <div style={{ display: "inline-block", padding: "6px 14px", background: `${theme.gold}22`, color: theme.plum, borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "1px", marginBottom: "16px" }}>STEP 1 OF 1 · TELL US ABOUT YOUR SPACE</div>
                    <h2 className="anim-fadeUp" style={{ fontSize: "3rem", fontWeight: 500, margin: "0 0 14px", lineHeight: 1.05, fontFamily: fontDisplay, letterSpacing: "-1px" }}>Let's design <em style={{ fontStyle: "italic", color: theme.terracotta }}>your perfect</em> home.</h2>
                    <p style={{ color: theme.muted, fontSize: "1.05rem", maxWidth: "600px", lineHeight: 1.6 }}>Choose your house type and preferred style — we'll generate floor plans tailored to how you actually want to live.</p>
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

                {/* STYLE */}
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

                {/* DETAILS */}
                <section style={{ maxWidth: "1100px", margin: "0 auto 32px" }}>
                    <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>A few details</h3>
                    <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>{houseType ? `Specific to your ${houseType === "others" ? "space" : houseType}.` : "Select a house type above to see relevant questions."}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", background: theme.card, padding: "24px", borderRadius: "14px", border: `1px solid ${theme.line}` }}>
                        <div>
                            <label style={labelStyle}>BEDROOMS</label>
                            <input type="number" min="1" placeholder="e.g. 3" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="planora-input" style={inputStyle} />
                        </div>
                        {(houseType === "villa" || houseType === "bungalow") && (<>
                            <div><label style={labelStyle}>NUMBER OF FLOORS</label><input type="number" min="1" placeholder="e.g. 2" value={numFloors} onChange={(e) => setNumFloors(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>PLOT AREA (SQ.FT)</label><input type="number" min="1" placeholder="e.g. 2400" value={plotArea} onChange={(e) => setPlotArea(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>GARDEN?</label><select value={hasGarden} onChange={(e) => setHasGarden(e.target.value)} className="planora-input" style={{ ...inputStyle, cursor: "pointer" }}><option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option></select></div>
                            <div><label style={labelStyle}>PARKING SPACES</label><input type="number" min="0" placeholder="e.g. 2" value={hasParking} onChange={(e) => setHasParking(e.target.value)} className="planora-input" style={inputStyle} /></div>
                        </>)}
                        {(houseType === "apartment" || houseType === "studio") && (<>
                            <div><label style={labelStyle}>FLOOR NUMBER</label><input type="number" min="0" placeholder="e.g. 7" value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>CARPET AREA (SQ.FT)</label><input type="number" min="1" placeholder="e.g. 1200" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>BALCONY?</label><select value={hasBalcony} onChange={(e) => setHasBalcony(e.target.value)} className="planora-input" style={{ ...inputStyle, cursor: "pointer" }}><option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option></select></div>
                            <div><label style={labelStyle}>PROPERTY AGE (YEARS)</label><input type="number" min="0" placeholder="e.g. 5" value={propertyAge} onChange={(e) => setPropertyAge(e.target.value)} className="planora-input" style={inputStyle} /></div>
                        </>)}
                        {(houseType === "townhouse" || houseType === "duplex") && (<>
                            <div><label style={labelStyle}>NUMBER OF FLOORS</label><input type="number" min="1" placeholder="e.g. 2" value={numFloors} onChange={(e) => setNumFloors(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>CARPET AREA (SQ.FT)</label><input type="number" min="1" placeholder="e.g. 1800" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} /></div>
                            <div><label style={labelStyle}>PARKING SPACES</label><input type="number" min="0" placeholder="e.g. 1" value={hasParking} onChange={(e) => setHasParking(e.target.value)} className="planora-input" style={inputStyle} /></div>
                        </>)}
                        {houseType === "others" && (
                            <div><label style={labelStyle}>AREA (SQ.FT)</label><input type="number" min="1" placeholder="e.g. 1500" value={carpetArea} onChange={(e) => setCarpetArea(e.target.value)} className="planora-input" style={inputStyle} /></div>
                        )}
                        <div>
                            <label style={labelStyle}>BUDGET (OPTIONAL)</label>
                            <input type="text" placeholder="e.g. ₹50L" value={budget} onChange={(e) => setBudget(e.target.value)} className="planora-input" style={inputStyle} />
                        </div>
                    </div>
                </section>

                {/* PERSONAL PREFERENCES */}
                <section style={{ maxWidth: "1100px", margin: "0 auto 32px" }}>
                    <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>Personal preferences <span style={{ color: theme.muted, fontWeight: 400, fontSize: "0.85rem" }}>· optional</span></h3>
                    <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>Tell us anything specific — pet-friendly, home office, big kitchen, natural light…</p>
                    <div style={{ background: theme.card, padding: "24px", borderRadius: "14px", border: `1px solid ${theme.line}` }}>
                        <label style={labelStyle}>DESCRIPTION</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. I work from home, love natural light, need a pet corner, prefer open kitchen…" rows={4} className="planora-input" style={{ ...inputStyle, resize: "vertical", fontFamily: fontBody, lineHeight: 1.5, minHeight: "100px" }} />
                    </div>
                </section>

                {/* BLUEPRINT UPLOAD */}
                <section style={{ maxWidth: "1100px", margin: "0 auto 48px" }}>
                    <h3 style={{ fontSize: "1.15rem", fontWeight: 600, margin: "0 0 6px" }}>Existing blueprint <span style={{ color: theme.muted, fontWeight: 400, fontSize: "0.85rem" }}>· optional</span></h3>
                    <p style={{ color: theme.muted, fontSize: "0.9rem", margin: "0 0 20px" }}>Upload a plot or apartment blueprint if you have one.</p>
                    <label htmlFor="blueprint-upload" style={{ display: "block", background: theme.card, padding: "40px 24px", borderRadius: "14px", border: `2px dashed ${blueprintFile ? theme.terracotta : theme.line}`, textAlign: "center", cursor: "pointer", transition: "border-color 0.25s ease" }}>
                        <input id="blueprint-upload" type="file" accept="image/*,.pdf,.dwg,.dxf" onChange={(e) => setBlueprintFile(e.target.files[0] || null)} style={{ display: "none" }} />
                        {blueprintFile ? (
                            <div>
                                <div style={{ fontSize: "2rem", marginBottom: "10px" }}>📐</div>
                                <div style={{ fontWeight: 600, color: theme.ink, marginBottom: "4px" }}>{blueprintFile.name}</div>
                                <div style={{ fontSize: "0.82rem", color: theme.muted }}>{(blueprintFile.size / 1024).toFixed(1)} KB · Click to change</div>
                                <button type="button" onClick={(e) => { e.preventDefault(); setBlueprintFile(null); }} style={{ marginTop: "12px", background: "transparent", border: `1px solid ${theme.line}`, color: theme.muted, padding: "6px 14px", borderRadius: "999px", cursor: "pointer", fontSize: "0.78rem", fontFamily: fontBody }}>Remove</button>
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
                    <button className="planora-btn" onClick={() => { setHouseType(""); setStyle(""); setBedrooms(""); setBudget(""); setNumFloors(""); setPlotArea(""); setFloorNumber(""); setCarpetArea(""); setHasBalcony(""); setHasGarden(""); setHasParking(""); setPropertyAge(""); setDescription(""); setBlueprintFile(null); }} style={{ padding: "14px 24px", background: "transparent", color: theme.muted, border: `1px solid ${theme.line}`, borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem", fontWeight: 500, fontFamily: fontBody }}>Reset</button>
                    <button className="planora-btn" disabled={!canContinue} onClick={() => { setOnboardingDone(true); setPage("generator"); }} style={{ padding: "14px 32px", background: canContinue ? `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)` : theme.line, color: theme.cream, border: "none", borderRadius: "999px", cursor: canContinue ? "pointer" : "not-allowed", fontSize: "0.95rem", fontWeight: 600, letterSpacing: "0.3px", boxShadow: canContinue ? `0 10px 24px ${theme.forest}40` : "none", fontFamily: fontBody }}>Continue to Generator →</button>
                </div>
            </div>
        );
    }

    // =====================================================
    // PROFILE PAGE
    // =====================================================
    if (page === "profile" && user) {
        const initials = (user?.displayName || user?.email || "U").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
        return (
            <div className="anim-fadeIn" style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${theme.cream} 0%, ${theme.ivory} 100%)`, fontFamily: fontBody, color: theme.ink, padding: "32px 48px 80px" }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "48px", paddingBottom: "20px", borderBottom: `1px solid ${theme.line}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <svg width="28" height="28" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" /><line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" /><line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" /><circle cx="30" cy="12" r="3" fill={theme.terracotta} /></svg>
                        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, fontFamily: fontDisplay, letterSpacing: "-0.5px" }}>Planora <span style={{ color: theme.muted, fontWeight: 400, fontStyle: "italic" }}>· Profile</span></h1>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <button className="planora-btn" onClick={() => setDarkMode(!darkMode)} style={{ width: "40px", height: "40px", borderRadius: "50%", background: theme.card, border: `1px solid ${theme.line}`, cursor: "pointer", fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center", color: theme.ink }}>{darkMode ? "☀" : "☾"}</button>
                        <button className="planora-btn" onClick={() => setPage("generator")} style={{ padding: "9px 18px", borderRadius: "999px", cursor: "pointer", background: "transparent", border: `1px solid ${theme.line}`, fontSize: "0.85rem", color: theme.ink, fontFamily: fontBody }}>← Back to Studio</button>
                        <button className="planora-btn" onClick={handleLogout} style={{ padding: "9px 18px", borderRadius: "999px", cursor: "pointer", background: theme.ink, color: theme.cream, border: "none", fontSize: "0.85rem", fontFamily: fontBody, fontWeight: 500 }}>Logout</button>
                    </div>
                </header>

                {/* PROFILE HERO */}
                <div className="anim-fadeUp grain" style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 50%, ${theme.plum} 100%)`, padding: "48px", borderRadius: "24px", color: theme.cream, marginBottom: "40px", display: "flex", alignItems: "center", gap: "32px", flexWrap: "wrap", position: "relative", overflow: "hidden", boxShadow: `0 24px 60px ${theme.forest}40` }}>
                    <div style={{ position: "absolute", width: "400px", height: "400px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}25 0%, transparent 70%)`, top: "-150px", right: "-80px", pointerEvents: "none" }} />
                    <div className="anim-scaleIn" style={{ width: "120px", height: "120px", borderRadius: "50%", background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.cream, border: `4px solid ${theme.cream}20`, boxShadow: `0 20px 50px ${theme.terracotta}40`, position: "relative", zIndex: 1, flexShrink: 0 }}>{initials}</div>
                    <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: "240px" }}>
                        <div style={{ fontSize: "0.72rem", letterSpacing: "2px", opacity: 0.7, fontWeight: 600, marginBottom: "8px" }}>✦ PLANORA MEMBER</div>
                        <h2 style={{ fontSize: "2.8rem", fontFamily: fontDisplay, fontWeight: 500, margin: "0 0 6px", letterSpacing: "-1px", lineHeight: 1.05 }}>{user?.displayName || "Welcome"}</h2>
                        <p style={{ margin: "0 0 20px", opacity: 0.8, fontSize: "0.95rem" }}>{user?.email}</p>
                        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                            <div><div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>{savedDesigns.length}</div><div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Saved designs</div></div>
                            <div style={{ width: "1px", background: `${theme.cream}30` }} />
                            <div><div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>{10 - saveCount}</div><div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Slots remaining</div></div>
                            <div style={{ width: "1px", background: `${theme.cream}30` }} />
                            <div><div style={{ fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.gold }}>Free</div><div style={{ fontSize: "0.72rem", opacity: 0.7, letterSpacing: "1px", textTransform: "uppercase" }}>Current plan</div></div>
                        </div>
                    </div>
                </div>

                {/* PREFERENCES */}
                <div className="anim-fadeUp" style={{ background: theme.card, padding: "32px", borderRadius: "20px", border: `1px solid ${theme.line}`, marginBottom: "40px", animationDelay: "0.1s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
                        <h3 style={{ margin: 0, fontSize: "1.3rem", fontFamily: fontDisplay, fontWeight: 600 }}>Your preferences</h3>
                        <button className="planora-btn" onClick={() => setPage("onboarding")} style={{ background: "transparent", border: `1px solid ${theme.line}`, padding: "8px 16px", borderRadius: "999px", cursor: "pointer", color: theme.ink, fontSize: "0.82rem", fontFamily: fontBody }}>Edit</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "20px" }}>
                        {[{ label: "HOUSE TYPE", value: houseType }, { label: "STYLE", value: style }, { label: "BEDROOMS", value: bedrooms }, { label: "BUDGET", value: budget }].map((item, i) => (
                            <div key={i}>
                                <div style={{ fontSize: "0.68rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "4px" }}>{item.label}</div>
                                <div style={{ fontSize: "1.1rem", fontFamily: fontDisplay, fontWeight: 500, textTransform: ["HOUSE TYPE", "STYLE"].includes(item.label) ? "capitalize" : "none", color: item.value ? theme.ink : theme.muted }}>{item.value || "—"}</div>
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
                        <h3 style={{ margin: 0, fontSize: "1.6rem", fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-0.5px" }}>Saved <em style={{ fontStyle: "italic", color: theme.terracotta }}>designs</em></h3>
                        <span style={{ color: theme.muted, fontSize: "0.9rem" }}>{savedDesigns.length} of 10 free slots used</span>
                    </div>
                    {savedDesigns.length === 0 ? (
                        <div style={{ padding: "72px 20px", textAlign: "center", border: `2px dashed ${theme.line}`, borderRadius: "20px", background: theme.card }}>
                            <div style={{ fontSize: "3rem", marginBottom: "16px", opacity: 0.4 }}>✦</div>
                            <h4 style={{ fontFamily: fontDisplay, fontWeight: 500, fontSize: "1.3rem", margin: "0 0 8px" }}>No saved designs yet</h4>
                            <p style={{ color: theme.muted, margin: "0 0 20px", fontSize: "0.95rem" }}>Generate your first layout and hit save — it'll show up here.</p>
                            <button className="planora-btn" onClick={() => setPage("generator")} style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: theme.cream, padding: "12px 28px", border: "none", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontFamily: fontBody, fontSize: "0.9rem", boxShadow: `0 10px 24px ${theme.forest}40` }}>Start designing →</button>
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
                            {savedDesigns.map((d, i) => (
                                <div key={d.id} className="planora-card anim-scaleIn" style={{ background: theme.card, padding: "24px", borderRadius: "18px", border: `1px solid ${theme.line}`, animationDelay: `${i * 0.08}s`, position: "relative", overflow: "hidden" }}>
                                    <div style={{ aspectRatio: "16/9", background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, borderRadius: "12px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                                        <svg viewBox="0 0 200 120" style={{ width: "75%", height: "75%" }}>
                                            <rect x="10" y="10" width="180" height="100" fill="none" stroke={theme.gold} strokeWidth="1.5" />
                                            <line x1="10" y1="60" x2="110" y2="60" stroke={theme.gold} strokeWidth="1.5" />
                                            <line x1="110" y1="10" x2="110" y2="90" stroke={theme.gold} strokeWidth="1.5" />
                                            <rect x="20" y="20" width="16" height="3" fill={theme.terracotta} />
                                            <circle cx="150" cy="35" r="10" fill="none" stroke={theme.gold} strokeWidth="1" />
                                        </svg>
                                        <div style={{ position: "absolute", top: "10px", right: "10px", background: `${theme.cream}e0`, color: theme.ink, fontSize: "0.68rem", fontWeight: 600, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.5px" }}>{d.rooms.length} ROOMS</div>
                                    </div>
                                    <h4 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontFamily: fontDisplay, fontWeight: 600, textTransform: "capitalize", letterSpacing: "-0.3px" }}>{d.name}</h4>
                                    <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
                                        {d.houseType && <span style={{ fontSize: "0.7rem", background: `${theme.forest}15`, color: theme.forest, padding: "3px 10px", borderRadius: "999px", textTransform: "capitalize", fontWeight: 600 }}>{d.houseType}</span>}
                                        {d.style && <span style={{ fontSize: "0.7rem", background: `${theme.terracotta}15`, color: theme.terracotta, padding: "3px 10px", borderRadius: "999px", textTransform: "capitalize", fontWeight: 600 }}>{d.style}</span>}
                                        {d.bedrooms && <span style={{ fontSize: "0.7rem", background: `${theme.gold}20`, color: darkMode ? theme.gold : "#8b6f0a", padding: "3px 10px", borderRadius: "999px", fontWeight: 600 }}>{d.bedrooms} BR</span>}
                                    </div>
                                    <div style={{ fontSize: "0.78rem", color: theme.muted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span>Saved {d.savedAt}</span>
                                        <button onClick={() => setSavedDesigns((prev) => prev.filter((x) => x.id !== d.id))} style={{ background: "transparent", border: "none", color: theme.muted, cursor: "pointer", fontSize: "0.78rem", padding: 0, fontFamily: fontBody }} className="planora-link">Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
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
        const testimonials = [
            { quote: "It replaced three architect consultations. Seriously.", name: "Meera S.", role: "Homeowner, Bangalore" },
            { quote: "The style presets nailed exactly what I couldn't describe.", name: "Arjun R.", role: "First-time buyer" },
            { quote: "From idea to blueprint in one evening. Unreal.", name: "Priya K.", role: "Interior enthusiast" },
        ];
        const marqueeItems = ["Villas", "Apartments", "Bungalows", "Studios", "Duplexes", "Townhouses", "Cottages", "Lofts"];

        return (
            <div style={{ backgroundColor: theme.cream, color: theme.ink, minHeight: "100vh", fontFamily: fontBody, overflow: "hidden" }}>
                {/* NAV */}
                <nav className="anim-fadeIn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 48px", position: "sticky", top: 0, zIndex: 100, background: `${theme.cream}dd`, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${theme.line}60` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="26" height="26" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" /><line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" /><line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" /><circle cx="30" cy="12" r="3" fill={theme.terracotta} /></svg>
                        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.5px", margin: 0, fontFamily: fontDisplay }}>Planora</h1>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
                        <a href="#features" className="planora-link" style={{ color: theme.ink, textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>Features</a>
                        <a href="#how" className="planora-link" style={{ color: theme.ink, textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>How it works</a>
                        <a href="#stories" className="planora-link" style={{ color: theme.ink, textDecoration: "none", fontSize: "0.9rem", fontWeight: 500 }}>Stories</a>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <button className="planora-btn" onClick={() => setDarkMode(!darkMode)} style={{ width: "40px", height: "40px", borderRadius: "50%", background: theme.card, border: `1px solid ${theme.line}`, cursor: "pointer", fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center", color: theme.ink }}>{darkMode ? "☀" : "☾"}</button>
                            <button className="planora-btn" onClick={() => setPage("login")} style={{ background: "transparent", color: theme.ink, border: `1px solid ${theme.ink}`, padding: "10px 22px", borderRadius: "999px", fontWeight: 500, cursor: "pointer", fontFamily: fontBody }}>Login</button>
                            <button className="planora-btn" onClick={() => setPage("signup")} style={{ background: theme.terracotta, color: theme.cream, border: "none", padding: "10px 24px", borderRadius: "999px", fontWeight: 600, cursor: "pointer", boxShadow: `0 6px 20px ${theme.terracotta}50`, fontFamily: fontBody }}>Sign up</button>
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
                                <button className="planora-btn" onClick={() => setPage("signup")} style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: theme.cream, border: "none", padding: "16px 32px", borderRadius: "999px", fontSize: "1rem", fontWeight: 600, cursor: "pointer", boxShadow: `0 14px 32px ${theme.forest}50`, fontFamily: fontBody }}>Start designing — Free</button>
                                <button className="planora-btn" onClick={() => setPage("login")} style={{ background: "transparent", color: theme.ink, border: "none", padding: "16px 20px", fontSize: "1rem", fontWeight: 500, cursor: "pointer", fontFamily: fontBody, display: "flex", alignItems: "center", gap: "8px" }}>Watch demo <span style={{ fontSize: "1.2rem" }}>→</span></button>
                            </div>
                            <div className="anim-fadeUp" style={{ marginTop: "48px", display: "flex", gap: "32px", animationDelay: "0.65s" }}>
                                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>12k+</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Homes designed</div></div>
                                <div style={{ width: "1px", background: theme.line }} />
                                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>4.9★</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>User rating</div></div>
                                <div style={{ width: "1px", background: theme.line }} />
                                <div><div style={{ fontSize: "1.8rem", fontWeight: 600, fontFamily: fontDisplay, color: theme.forest }}>60s</div><div style={{ fontSize: "0.78rem", color: theme.muted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Avg generation</div></div>
                            </div>
                        </div>
                        <div className="anim-scaleIn" style={{ aspectRatio: "1/1", background: `linear-gradient(160deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`, borderRadius: "28px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", boxShadow: `0 40px 80px ${theme.forest}40, 0 0 0 1px ${theme.forest}20`, animationDelay: "0.3s" }}>
                            <div style={{ position: "absolute", width: "80%", height: "80%", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}30 0%, transparent 60%)`, top: "10%", left: "10%", animation: "pulse 4s ease-in-out infinite" }} />
                            <svg viewBox="0 0 400 400" style={{ width: "85%", height: "85%", position: "relative", zIndex: 1 }}>
                                <rect x="40" y="40" width="320" height="320" fill="none" stroke={theme.gold} strokeWidth="2.5" className="floor-line" />
                                <line x1="40" y1="180" x2="220" y2="180" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "0.5s" }} />
                                <line x1="220" y1="40" x2="220" y2="280" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "0.9s" }} />
                                <line x1="220" y1="280" x2="360" y2="280" stroke={theme.gold} strokeWidth="2.5" className="floor-line" style={{ animationDelay: "1.3s" }} />
                                <rect x="60" y="60" width="50" height="6" fill={theme.terracotta} className="anim-fadeIn" style={{ animationDelay: "2s" }} />
                                <rect x="300" y="354" width="50" height="6" fill={theme.terracotta} className="anim-fadeIn" style={{ animationDelay: "2.2s" }} />
                                <circle cx="290" cy="120" r="35" fill="none" stroke={theme.gold} strokeWidth="2" className="anim-scaleIn" style={{ animationDelay: "2.4s", transformOrigin: "290px 120px" }} />
                                <text x="120" y="115" fill={theme.cream} fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.6s" }}>LIVING</text>
                                <text x="120" y="245" fill={theme.cream} fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.7s" }}>BEDROOM</text>
                                <text x="280" y="200" fill={theme.cream} fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.8s" }}>KITCHEN</text>
                                <text x="280" y="325" fill={theme.cream} fontSize="12" fontFamily={fontBody} opacity="0.7" className="anim-fadeIn" style={{ animationDelay: "2.9s" }}>BATH</text>
                            </svg>
                            <div className="anim-float" style={{ position: "absolute", top: "24px", right: "24px", background: theme.cream, color: theme.ink, padding: "10px 16px", borderRadius: "999px", fontSize: "0.78rem", fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80" }} />Live preview
                            </div>
                        </div>
                    </main>
                </section>

                {/* MARQUEE */}
                <section style={{ padding: "24px 0", background: theme.ink, color: theme.cream, overflow: "hidden", borderTop: `1px solid ${theme.forest}`, borderBottom: `1px solid ${theme.forest}` }}>
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
                        <h2 style={{ fontSize: "3.2rem", fontFamily: fontDisplay, fontWeight: 500, margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>Every tool your home <br /><em style={{ fontStyle: "italic", color: theme.terracotta }}>deserves.</em></h2>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
                        {features.map((f, i) => (
                            <div key={i} className="planora-card scroll-reveal" style={{ padding: "36px 32px", background: theme.card, borderRadius: "20px", border: `1px solid ${theme.line}`, position: "relative", overflow: "hidden", transitionDelay: `${i * 0.08}s` }}>
                                <div style={{ width: "56px", height: "56px", borderRadius: "14px", background: `linear-gradient(135deg, ${theme.forest}15 0%, ${theme.terracotta}15 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", color: theme.forest, marginBottom: "20px" }}>{f.icon}</div>
                                <h3 style={{ fontSize: "1.25rem", margin: "0 0 10px", fontFamily: fontDisplay, fontWeight: 600 }}>{f.title}</h3>
                                <p style={{ color: theme.muted, lineHeight: 1.6, margin: 0, fontSize: "0.94rem" }}>{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* HOW IT WORKS */}
                <section id="how" style={{ padding: "120px 48px", background: `linear-gradient(180deg, ${theme.ivory} 0%, ${theme.cream} 100%)`, borderTop: `1px solid ${theme.line}`, borderBottom: `1px solid ${theme.line}` }}>
                    <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
                        <div className="scroll-reveal" style={{ textAlign: "center", marginBottom: "72px" }}>
                            <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "16px" }}>✦ HOW IT WORKS</div>
                            <h2 style={{ fontSize: "3.2rem", fontFamily: fontDisplay, fontWeight: 500, margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>From blank page <br /> to blueprint in <em style={{ fontStyle: "italic", color: theme.terracotta }}>three steps.</em></h2>
                        </div>
                        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "32px" }}>
                            {steps.map((s, i) => (
                                <div key={i} className="planora-card scroll-reveal" style={{ background: theme.card, padding: "40px 32px", borderRadius: "20px", border: `1px solid ${theme.line}`, transitionDelay: `${i * 0.12}s` }}>
                                    <div style={{ fontSize: "4rem", fontFamily: fontDisplay, fontWeight: 500, fontStyle: "italic", color: theme.terracotta, lineHeight: 1, marginBottom: "20px", opacity: 0.9 }}>{s.n}</div>
                                    <h3 style={{ fontSize: "1.35rem", margin: "0 0 10px", fontFamily: fontDisplay, fontWeight: 600 }}>{s.title}</h3>
                                    <p style={{ color: theme.muted, lineHeight: 1.6, margin: 0 }}>{s.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* TESTIMONIALS */}
                <section id="stories" style={{ padding: "120px 48px", maxWidth: "1280px", margin: "0 auto" }}>
                    <div className="scroll-reveal" style={{ textAlign: "center", marginBottom: "72px" }}>
                        <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "16px" }}>✦ STORIES FROM HOMES</div>
                        <h2 style={{ fontSize: "3.2rem", fontFamily: fontDisplay, fontWeight: 500, margin: 0, letterSpacing: "-1px", lineHeight: 1.1 }}>Loved by <em style={{ fontStyle: "italic", color: theme.terracotta }}>dreamers</em> <br />and builders alike.</h2>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
                        {testimonials.map((t, i) => (
                            <div key={i} className="planora-card scroll-reveal" style={{ background: i === 1 ? theme.forest : theme.card, color: i === 1 ? theme.cream : theme.ink, padding: "40px 32px", borderRadius: "20px", border: i === 1 ? "none" : `1px solid ${theme.line}`, transitionDelay: `${i * 0.12}s` }}>
                                <div style={{ fontSize: "4rem", fontFamily: fontDisplay, lineHeight: 0.5, color: i === 1 ? theme.gold : theme.terracotta, marginBottom: "16px" }}>"</div>
                                <p style={{ fontSize: "1.15rem", lineHeight: 1.5, fontFamily: fontDisplay, fontStyle: "italic", fontWeight: 400, margin: "0 0 28px" }}>{t.quote}</p>
                                <div style={{ borderTop: `1px solid ${i === 1 ? theme.gold + "40" : theme.line}`, paddingTop: "16px" }}>
                                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{t.name}</div>
                                    <div style={{ fontSize: "0.82rem", opacity: 0.7 }}>{t.role}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* FINAL CTA */}
                <section style={{ padding: "60px 48px 120px" }}>
                    <div className="scroll-reveal-scale grain" style={{ maxWidth: "1280px", margin: "0 auto", background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 50%, ${theme.plum} 100%)`, borderRadius: "32px", padding: "96px 48px", textAlign: "center", position: "relative", overflow: "hidden" }}>
                        <svg viewBox="0 0 1200 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.08 }}>
                            <rect x="80" y="80" width="240" height="240" fill="none" stroke={theme.gold} strokeWidth="2" />
                            <rect x="880" y="80" width="240" height="240" fill="none" stroke={theme.gold} strokeWidth="2" />
                            <line x1="80" y1="200" x2="200" y2="200" stroke={theme.gold} strokeWidth="2" />
                            <line x1="880" y1="200" x2="1120" y2="200" stroke={theme.gold} strokeWidth="2" />
                            <line x1="200" y1="80" x2="200" y2="320" stroke={theme.gold} strokeWidth="2" />
                        </svg>
                        <div style={{ position: "relative", zIndex: 1 }}>
                            <h2 style={{ fontSize: "3.8rem", fontFamily: fontDisplay, fontWeight: 500, color: theme.cream, margin: "0 0 20px", lineHeight: 1.05, letterSpacing: "-1px" }}>Your dream home is <br /><em style={{ fontStyle: "italic", color: theme.gold }}>one click away.</em></h2>
                            <p style={{ color: `${theme.cream}cc`, fontSize: "1.1rem", maxWidth: "520px", margin: "0 auto 40px", lineHeight: 1.6 }}>Join thousands of homeowners designing their perfect space with Planora. No credit card, no commitment — just pure creation.</p>
                            <button className="planora-btn" onClick={() => setPage("signup")} style={{ background: theme.cream, color: theme.ink, border: "none", padding: "18px 40px", borderRadius: "999px", fontSize: "1.05rem", fontWeight: 600, cursor: "pointer", boxShadow: `0 20px 50px ${theme.ink}50`, fontFamily: fontBody }}>Start designing free →</button>
                        </div>
                    </div>
                </section>

                {/* FOOTER */}
                <footer style={{ padding: "40px 48px", borderTop: `1px solid ${theme.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="22" height="22" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" /><line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" /><line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" /><circle cx="30" cy="12" r="3" fill={theme.terracotta} /></svg>
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
        <div className="anim-fadeIn" style={{ padding: "32px 48px 80px", fontFamily: fontBody, background: `linear-gradient(180deg, ${theme.cream} 0%, ${theme.ivory} 100%)`, minHeight: "100vh", color: theme.ink }}>
            {/* HEADER */}
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px", paddingBottom: "20px", borderBottom: `1px solid ${theme.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <svg width="28" height="28" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" fill="none" stroke={theme.forest} strokeWidth="2.5" /><line x1="4" y1="20" x2="22" y2="20" stroke={theme.forest} strokeWidth="2.5" /><line x1="22" y1="4" x2="22" y2="28" stroke={theme.forest} strokeWidth="2.5" /><circle cx="30" cy="12" r="3" fill={theme.terracotta} /></svg>
                    <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, fontFamily: fontDisplay, letterSpacing: "-0.5px" }}>Planora <span style={{ color: theme.muted, fontWeight: 400, fontStyle: "italic" }}>· Studio</span></h1>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ color: theme.muted, fontSize: "0.9rem", marginRight: "6px" }}>Hi, <strong style={{ color: theme.ink }}>{user?.displayName || user?.email}</strong></span>
                    <button className="planora-btn" onClick={() => setDarkMode(!darkMode)} style={{ width: "40px", height: "40px", borderRadius: "50%", background: theme.card, border: `1px solid ${theme.line}`, cursor: "pointer", fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center", color: theme.ink }}>{darkMode ? "☀" : "☾"}</button>
                    <button className="planora-btn" onClick={() => setPage("profile")} style={{ padding: "9px 18px", borderRadius: "999px", cursor: "pointer", background: "transparent", border: `1px solid ${theme.line}`, fontSize: "0.85rem", fontFamily: fontBody, color: theme.ink }}>Profile</button>
                    <button className="planora-btn" onClick={() => setPage("onboarding")} style={{ padding: "9px 18px", borderRadius: "999px", cursor: "pointer", background: "transparent", border: `1px solid ${theme.line}`, fontSize: "0.85rem", fontFamily: fontBody, color: theme.ink }}>Edit preferences</button>
                    <button className="planora-btn" onClick={handleLogout} style={{ padding: "9px 18px", borderRadius: "999px", cursor: "pointer", background: theme.ink, color: theme.cream, border: "none", fontSize: "0.85rem", fontFamily: fontBody, fontWeight: 500 }}>Logout</button>
                </div>
            </header>

            {/* WELCOME */}
            <div className="anim-fadeUp" style={{ marginBottom: "32px" }}>
                <div style={{ fontSize: "0.78rem", color: theme.terracotta, letterSpacing: "2px", fontWeight: 600, marginBottom: "10px" }}>✦ YOUR STUDIO</div>
                <h2 style={{ fontSize: "2.6rem", margin: 0, fontFamily: fontDisplay, fontWeight: 500, letterSpacing: "-1px", lineHeight: 1.1 }}>Let's build <em style={{ fontStyle: "italic", color: theme.terracotta }}>something beautiful.</em></h2>
            </div>

            {/* PROFILE SUMMARY */}
            <div className="anim-fadeUp grain" style={{ background: `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 60%, ${theme.plum} 100%)`, padding: "32px 36px", borderRadius: "20px", color: theme.cream, marginBottom: "28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "28px", boxShadow: `0 20px 50px ${theme.forest}30`, animationDelay: "0.15s", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", width: "300px", height: "300px", borderRadius: "50%", background: `radial-gradient(circle, ${theme.gold}25 0%, transparent 70%)`, top: "-100px", right: "-60px", pointerEvents: "none" }} />
                {[{ label: "HOUSE TYPE", value: houseType, cap: true }, { label: "STYLE", value: style, cap: true }, { label: "BEDROOMS", value: bedrooms }, { label: "BUDGET", value: budget }].map((item, i) => (
                    <div key={i} style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ fontSize: "0.68rem", letterSpacing: "1.5px", opacity: 0.7, fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: "1.25rem", fontWeight: 500, fontFamily: fontDisplay, marginTop: "6px", textTransform: item.cap ? "capitalize" : "none", color: item.value ? theme.cream : `${theme.cream}60` }}>{item.value || "—"}</div>
                    </div>
                ))}
            </div>

            {/* GENERATOR PANEL */}
            <div className="anim-fadeUp" style={{ background: theme.card, padding: "36px", borderRadius: "20px", boxShadow: "0 4px 30px rgba(20,17,15,0.06)", border: `1px solid ${theme.line}`, animationDelay: "0.25s" }}>
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
                            style={{ background: loadingPlan ? theme.line : `linear-gradient(135deg, ${theme.forest} 0%, ${theme.forestDeep} 100%)`, color: theme.cream, padding: "14px 28px", cursor: loadingPlan ? "wait" : "pointer", border: "none", borderRadius: "999px", fontWeight: 600, fontFamily: fontBody, fontSize: "0.95rem", boxShadow: loadingPlan ? "none" : `0 12px 28px ${theme.forest}40`, display: "flex", alignItems: "center", gap: "8px" }}
                        >
                            {loadingPlan ? (
                                <>
                                    <span style={{ display: "inline-block", width: "14px", height: "14px", border: `2px solid ${theme.cream}40`, borderTop: `2px solid ${theme.cream}`, borderRadius: "50%", animation: "rotateSlow 0.8s linear infinite" }} />
                                    Generating…
                                </>
                            ) : "✦ Generate Design"}
                        </button>
                        {/* Existing Generate Button */}
                        <button onClick={generateFloorPlan} disabled={loadingPlan}>
                            {loadingPlan ? "Generating..." : "Generate Design"}
                        </button>

                        {/* ✅ ADD THIS NEW BUTTON: */}
                        {floors.length > 0 && (
                            <button
                                onClick={downloadPDF}
                                style={{
                                    marginLeft: '10px',
                                    backgroundColor: '#27ae60', // Green color
                                    color: 'white',
                                    padding: '10px 20px',
                                    borderRadius: '5px',
                                    cursor: 'pointer'
                                }}
                            >
                                📥 Download as PDF
                            </button>
                        )}
                        {floors.length > 0 && (
                            <button className="planora-btn" onClick={saveDesign} style={{ background: `linear-gradient(135deg, ${theme.gold} 0%, #b8870a 100%)`, color: theme.ink, padding: "14px 24px", border: "none", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontFamily: fontBody, fontSize: "0.95rem", boxShadow: `0 10px 24px ${theme.gold}40` }}>
                                ⬡ Save ({saveCount}/10)
                            </button>
                        )}
                    </div>
                </div>

                {/* Empty state */}
                {floors.length === 0 && !loadingPlan && (
                    <div style={{ padding: "60px 20px", textAlign: "center", border: `2px dashed ${theme.line}`, borderRadius: "16px", background: theme.cream }}>
                        <div style={{ fontSize: "2.4rem", marginBottom: "12px", opacity: 0.5 }}>✦</div>
                        <p style={{ color: theme.muted, margin: 0, fontSize: "0.95rem" }}>
                            No rooms yet. Click <strong style={{ color: theme.ink }}>Generate Design</strong> to create your layout.
                        </p>
                    </div>
                )}

                {/* Loading state */}
                {loadingPlan && (
                    <div style={{ padding: "60px 20px", textAlign: "center", border: `2px dashed ${theme.terracotta}40`, borderRadius: "16px", background: `${theme.terracotta}05` }}>
                        <div style={{ fontSize: "2rem", marginBottom: "16px" }}>
                            <span style={{ display: "inline-block", width: "40px", height: "40px", border: `3px solid ${theme.terracotta}30`, borderTop: `3px solid ${theme.terracotta}`, borderRadius: "50%", animation: "rotateSlow 1s linear infinite" }} />
                        </div>
                        <p style={{ color: theme.terracotta, margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>AI is designing your floor plan…</p>
                        <p style={{ color: theme.muted, margin: "6px 0 0", fontSize: "0.85rem" }}>This usually takes 5–10 seconds</p>
                    </div>
                )}

                {/* Floor plan results */}
                {floors.length > 0 && !loadingPlan && (
                    <div>
                        <div style={{ fontSize: "0.75rem", color: theme.muted, letterSpacing: "1.5px", fontWeight: 600, marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                            YOUR LAYOUT · {floors.length} FLOOR{floors.length > 1 ? "S" : ""} · {floors.reduce((acc, f) => acc + f.rooms.length, 0)} ROOMS
                        </div>
                        {floors.map((floor, i) => (
                            <div key={i} style={{ marginBottom: "28px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                                    <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>{i + 1}</div>
                                    <h3 style={{ margin: 0, fontSize: "1.1rem", fontFamily: fontDisplay, fontWeight: 600, color: theme.ink }}>{floor.name}</h3>
                                    <span style={{ fontSize: "0.75rem", color: theme.muted, background: theme.sand, padding: "3px 10px", borderRadius: "999px" }}>{floor.rooms.length} rooms</span>
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", paddingLeft: "38px" }}>
                                    {floor.rooms.map((room, j) => (
                                        <div
                                            key={j}
                                            className="anim-scaleIn"
                                            // We add a 'title' so that when you hover over the room, the AI description pops up!
                                            title={room.description}
                                            style={{
                                                padding: "14px 20px",
                                                border: `1.5px solid ${theme.forest}30`,
                                                background: `linear-gradient(135deg, ${theme.forest}08 0%, ${theme.terracotta}06 100%)`,
                                                borderRadius: "12px",
                                                color: theme.ink,
                                                fontSize: "0.9rem",
                                                fontFamily: fontBody,
                                                animationDelay: `${j * 0.05}s`,
                                                display: "flex",
                                                flexDirection: "column", // Stack the name and dimensions
                                                gap: "2px",
                                                minWidth: "160px"
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: theme.terracotta, flexShrink: 0 }} />
                                                <strong style={{ fontWeight: 600 }}>{room.name}</strong>
                                            </div>

                                            {room.dimensions && (
                                                <span style={{ fontSize: "0.75rem", color: theme.muted, marginLeft: "14px" }}>
                                                    {room.dimensions}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* AI Suggestion */}
                {suggestion && (
                    <div className="anim-fadeUp" style={{ marginTop: "28px", padding: "20px 24px", background: `linear-gradient(135deg, ${theme.terracotta}10 0%, ${theme.gold}10 100%)`, border: `1px solid ${theme.terracotta}30`, borderRadius: "14px", display: "flex", alignItems: "flex-start", gap: "14px" }}>
                        <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: `linear-gradient(135deg, ${theme.terracotta} 0%, ${theme.gold} 100%)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", flexShrink: 0, fontWeight: 700 }}>✦</div>
                        <div>
                            <div style={{ fontSize: "0.72rem", color: theme.terracotta, letterSpacing: "1.5px", fontWeight: 700, marginBottom: "4px" }}>AI SUGGESTION</div>
                            <p style={{ margin: 0, color: theme.ink, lineHeight: 1.5, fontSize: "0.95rem" }}>{suggestion}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
