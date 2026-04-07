import { useState, useEffect } from "react";
import { auth, signInWithGoogle, logout } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("home"); // 'home' or 'generator'
  const [saveCount, setSaveCount] = useState(0);

  // Home Page State
  const [familySize, setFamilySize] = useState("");
  const [houseType, setHouseType] = useState("");
  const [style, setStyle] = useState("");
  const [rooms, setRooms] = useState([]);
  const [suggestion, setSuggestion] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) setPage("generator");
    });
    return () => unsubscribe();
  }, []);

  const saveDesign = () => {
    if (saveCount < 10) {
      setSaveCount(saveCount + 1);
      alert(`Design Saved! (${saveCount + 1}/10 free slots used)`);
    } else {
      alert("Free limit reached! (10/10). Payment gateway coming soon.");
    }
  };

  // --- STYLES (Lando Norris Inspired) ---
  const theme = {
    black: "#000000",
    white: "#ffffff",
    neon: "#dfff00", // LN4 Signature Yellow
    border: "2px solid #000"
  };

  if (page === "home" && !user) {
    return (
      <div style={{ backgroundColor: theme.black, color: theme.white, minHeight: "100vh", padding: "0" }}>
        {/* Navbar */}
        <nav style={{ display: "flex", justifyContent: "space-between", padding: "20px", borderBottom: `1px solid ${theme.white}` }}>
          <h1 style={{ fontSize: "2rem", fontWeight: "900", letterSpacing: "-2px" }}>PLANORA</h1>
          <div>
            <button onClick={signInWithGoogle} style={{ background: theme.neon, border: "none", padding: "10px 20px", fontWeight: "bold", cursor: "pointer" }}>
              LOGIN / SIGNUP
            </button>
          </div>
        </nav>

        {/* Hero Section */}
        <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "80vh" }}>
          <div style={{ borderRight: `1px solid ${theme.white}`, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px" }}>
            <h2 style={{ fontSize: "5rem", lineHeight: "0.9", marginBottom: "20px" }}>DESIGN <br/> WITHOUT <br/> LIMITS.</h2>
            <p style={{ maxWidth: "400px", color: "#aaa" }}>The ultimate AI-driven architectural planner for the next generation of homeowners.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <div style={{ width: "80%", height: "60%", border: `4px solid ${theme.neon}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
               <h3 style={{ transform: "rotate(-5deg)", fontSize: "3rem" }}>GENERATE NOW</h3>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- GENERATOR PAGE ---
  return (
    <div style={{ padding: "40px", fontFamily: "Arial", backgroundColor: "#f4f4f4", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>🏠 Planora Dashboard</h1>
        <div>
          <span style={{ marginRight: "15px" }}>Welcome, {user?.displayName}</span>
          <button onClick={logout} style={{ padding: "5px 10px" }}>Logout</button>
        </div>
      </header>

      <div style={{ background: "white", padding: "30px", marginTop: "20px", borderRadius: "12px", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
        <h3>Design Generator</h3>
        <input type="number" placeholder="Family size" value={familySize} onChange={(e) => setFamilySize(e.target.value)} />
        <br/><br/>
        <input type="text" placeholder="House Type (e.g. Villa)" value={houseType} onChange={(e) => setHouseType(e.target.value)} />
        <br/><br/>
        <input type="text" placeholder="Style (e.g. Modern)" value={style} onChange={(e) => setStyle(e.target.value)} />
        <br/><br/>
        
        <button 
          onClick={() => {
            if (familySize <= 2) setRooms(["Bedroom", "Hall", "Kitchen"]);
            else setRooms(["Bedroom", "Bedroom", "Hall", "Kitchen"]);
            setSuggestion("Layout generated based on your profile.");
          }}
          style={{ background: "#000", color: "#fff", padding: "10px 20px", cursor: "pointer" }}
        >
          Generate Design
        </button>

        {rooms.length > 0 && (
          <button onClick={saveDesign} style={{ marginLeft: "10px", background: "#dfff00", padding: "10px 20px", border: "1px solid black" }}>
            Save Design ({saveCount}/10 Free)
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
        {rooms.map((room, i) => (
          <div key={i} style={{ padding: "20px", border: "2px solid black", background: "#fff" }}>{room}</div>
        ))}
      </div>
      <p><strong>AI Suggestion:</strong> {suggestion}</p>
    </div>
  );
}

export default App;