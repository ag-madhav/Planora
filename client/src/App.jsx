import { useState } from "react"

function App() {
    const [familySize, setFamilySize] = useState("")
    const [houseType, setHouseType] = useState("")
    const [style, setStyle] = useState("")
    const [rooms, setRooms] = useState([])

    const [selectedRoom, setSelectedRoom] = useState(null)

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

            <button onClick={() => {
                if (familySize <= 2) {
                    setRooms(["Bedroom", "Hall", "Kitchen"])
                } else if (familySize <= 4) {
                    setRooms(["Bedroom", "Bedroom", "Hall", "Kitchen"])
                } else {
                    setRooms(["Bedroom", "Bedroom", "Bedroom", "Hall", "Kitchen"])
                }
            }}>
                Generate Home
            </button>

            <h2>Rooms:</h2>

            <p>Click a room to select it</p>

            <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                marginTop: "20px"
            }}>
                {rooms.map((room, index) => (
                    <div
                        key={index}
                        onClick={() => setSelectedRoom(index)}
                        style={{
                            border: "2px solid black",
                            padding: "20px",
                            width: "120px",
                            height: "80px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor:
                                selectedRoom === index
                                    ? "#ffd700"
                                    : room === "Bedroom"
                                        ? "#add8e6"
                                        : room === "Hall"
                                            ? "#90ee90"
                                            : room === "Kitchen"
                                                ? "#ffcc99"
                                                : "#f0f0f0",
                            cursor: "pointer"
                        }}
                    >
                        {room}
                    </div>
                ))}
            </div>

        </div>
    )
}

export default App

