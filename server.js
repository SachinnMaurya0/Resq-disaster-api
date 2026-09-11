const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const OPEN_WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

if (!OPEN_WEATHER_API_KEY) {
    console.error(
        "FATAL: OPENWEATHER_API_KEY environment variable is not set. " +
            "Add it in Render dashboard -> Environment, then redeploy."
    );
    process.exit(1);
}

const LEVEL_COLORS = {
    low: "#22C55E",
    moderate: "#F59E0B",
    high: "#F97316",
    extreme: "#EF4444",
};

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function levelFor(score) {
    if (score >= 0.75) return "Extreme";
    if (score >= 0.5) return "High";
    if (score >= 0.25) return "Moderate";
    return "Low";
}

function computeFloodScore(weatherId, rain) {
    let score = 0;

    if (weatherId >= 200 && weatherId < 300) score += 0.40;
    if (weatherId === 202 || weatherId === 212 || weatherId === 232) score += 0.50;
    if (weatherId >= 300 && weatherId < 400) score += 0.15;
    if (weatherId >= 500 && weatherId < 502) score += 0.35;
    if (weatherId >= 502 && weatherId < 600) score += 0.50;
    if (weatherId >= 600 && weatherId < 700) score += 0.20;

    if (rain >= 50) score += 0.50;
    else if (rain >= 25) score += 0.35;
    else if (rain >= 10) score += 0.20;
    else if (rain >= 2.5) score += 0.10;

    return clamp01(score);
}

function computeCycloneScore(windSpeed) {
    if (windSpeed >= 33) return 1.0;
    if (windSpeed >= 24) return 0.75;
    if (windSpeed >= 17) return 0.5;
    if (windSpeed >= 11) return 0.2;
    if (windSpeed >= 8) return 0.1;
    return 0;
}

function riskInfo(score) {
    const level = levelFor(score);
    return {
        level: level,
        score: Math.round(score * 100) / 100,
        color: LEVEL_COLORS[level.toLowerCase()] || LEVEL_COLORS.low,
    };
}

function recommendationsFor(floodScore, cycloneScore, temp, description) {
    const strongest = floodScore >= cycloneScore ? "flood" : "cyclone";
    const worst = Math.max(floodScore, cycloneScore);

    if (temp >= 45) {
        return [
            "Extreme heat detected - avoid outdoor activity.",
            "Drink water regularly and stay in shade.",
            "Check on elderly neighbours.",
        ];
    }
    if (temp <= 5) {
        return [
            "Very cold conditions - dress warmly.",
            "Protect exposed water pipes and crops.",
            "Use the ResQ mesh to coordinate local help.",
        ];
    }
    if (worst >= 0.5) {
        if (strongest === "flood") {
            return [
                "High flood risk - move to higher ground.",
                "Avoid crossing flooded roads or bridges.",
                "Keep food, water and documents ready.",
                "Share your SOS location over the ResQ mesh.",
            ];
        }
        return [
            "High cyclone risk - stay indoors away from windows.",
            "Secure loose outdoor objects.",
            "Keep an emergency kit ready.",
            "Follow local evacuation orders.",
        ];
    }
    if (worst >= 0.25) {
        return [
            "Moderate risk (" + description + ") - stay alert.",
            "Monitor updates on the ResQ mesh.",
            "Keep your phone charged and Bluetooth on.",
        ];
    }
    return [
        "No immediate weather risk detected.",
        "Keep the ResQ mesh active to stay informed.",
    ];
}

async function fetchWeather(lat, lon) {
    const url =
        "https://api.openweathermap.org/data/2.5/weather?" +
        "lat=" + lat + "&lon=" + lon +
        "&appid=" + OPEN_WEATHER_API_KEY +
        "&units=metric";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error("OpenWeatherMap returned " + res.status);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "ResQ Disaster Prediction API" });
});

app.post("/api/v1/predict", async (req, res) => {
    const lat = Number(req.body.latitude);
    const lon = Number(req.body.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ error: "latitude and longitude must be valid numbers" });
    }

    let weather;
    try {
        weather = await fetchWeather(lat, lon);
    } catch (e) {
        return res.status(502).json({ error: "Weather service unavailable right now" });
    }

    const code = weather.weather && weather.weather[0] ? weather.weather[0].id : 0;
    const description =
        weather.weather && weather.weather[0] ? weather.weather[0].description : "unknown";

    const rain = weather.rain ? weather.rain["1h"] || weather.rain["3h"] || 0 : 0;
    const windSpeed = weather.wind ? weather.wind.speed || 0 : 0;
    const temp = weather.main ? weather.main.temp || 0 : 0;

    const floodScore = computeFloodScore(code, rain);
    const cycloneScore = computeCycloneScore(windSpeed);
    const combinedScore = Math.max(floodScore, cycloneScore);

    res.json({
        location: { latitude: lat, longitude: lon },
        combined_risk: riskInfo(combinedScore),
        flood_risk: riskInfo(floodScore),
        cyclone_risk: riskInfo(cycloneScore),
        recommendations: recommendationsFor(floodScore, cycloneScore, temp, description),
        weather: {
            temperature: Math.round(temp * 10) / 10,
            description: description,
            wind_speed: windSpeed,
            rain_1h: Math.round(rain * 10) / 10,
        },
        note: "Risk based on live OpenWeatherMap data at request time.",
    });
});

app.listen(PORT, () => {
    console.log("ResQ Disaster API listening on port " + PORT);
});
