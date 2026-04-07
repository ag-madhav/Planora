import { useState } from "react"

function App() {
  const [familySize, setFamilySize] = useState("")
  const [houseType, setHouseType] = useState("")
  const [style, setStyle] = useState("")

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>🏠 Planora</h1>
      <p>Design your dream home</p>

      <br />

      <input
        type="number"
        placeholder="Enter family size"
        value={familySize}
        onChange={(e) => setFamilySize(e.target.value)}
      />

      <br /><br />

      <select onChange={(e) => setHouseType(e.target.value)}>
        <option value="">Select House Type</option>
        <option value="apartment">Apartment</option>
        <option value="villa">Villa</option>
      </select>

      <br /><br />

      <select onChange={(e) => setStyle(e.target.value)}>
        <option value="">Select Style</option>
        <option value="modern">Modern</option>
        <option value="traditional">Traditional</option>
        <option value="minimalist">Minimalist</option>
      </select>

      <br /><br />

      <button>Generate Home</button>
    </div>
  )
}

export default App