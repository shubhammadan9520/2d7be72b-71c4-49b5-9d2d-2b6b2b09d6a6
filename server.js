const express = require("express");
const cors = require("cors");
const moment = require("moment-timezone");
const fs = require("fs").promises;
const path = require("path");
const Papa = require("papaparse");

const app = express();
const port = process.env.PORT || 8081;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let devices = [];
let savingsData = [];

async function loadData() {
  try {
    const dataDir = path.join(__dirname, "data");
    await fs.access(dataDir);
    const devicesCsv = await fs.readFile(
      path.join(dataDir, "devices.csv"),
      "utf-8"
    );
    const savingsCsv = await fs.readFile(
      path.join(dataDir, "device-saving.csv"),
      "utf-8"
    );

    Papa.parse(devicesCsv, {
      header: true,
      skipEmptyLines: true,
      transform: (value) => value.trim().replace(/^"|"$/g, ""),
      complete: (results) => {
        devices = results.data.map((row) => ({
          id: parseInt(row["id"]),
          name: row["name"],
          timezone: moment.tz.zone(row["timezone"])
            ? row["timezone"]
            : "Asia/Kolkata",
        }));
      },
      error: (err) => console.error("Error parsing devices CSV:", err),
    });

    Papa.parse(savingsCsv, {
      header: true,
      skipEmptyLines: true,
      transform: (value, header) => {
        value = value.trim().replace(/^"|"$/g, "");
        if (header === "device_id") return parseInt(value);
        if (header === "carbon_saved" || header === "fueld_saved")
          return parseFloat(value) || 0;
        return value;
      },
      complete: (results) => {
        savingsData = results.data;
      },
      error: (err) => console.error("Error parsing savings CSV:", err),
    });
  } catch (error) {
    console.error("Error loading data or accessing directory:", error.message);
    if (error.code === "ENOENT") {
      console.error(
        'Data directory or files not found. Please create the "data" directory with devices.csv and device-saving.csv.'
      );
    }
  }
}

app.get("/api/devices", (req, res) => {
  res.json(devices);
});

app.get("/api/savings", (req, res) => {
  const { deviceId, startDateTime, endDateTime } = req.query;

  if (!deviceId || !startDateTime || !endDateTime) {
    return res
      .status(400)
      .json({ error: "deviceId, startDateTime, and endDateTime are required" });
  }

  const device = devices.find((d) => d.id === parseInt(deviceId));
  if (!device) {
    return res.status(404).json({ error: "Device not found" });
  }

  const start = moment.tz(startDateTime, device.timezone);
  const end = moment.tz(endDateTime, device.timezone);

  if (!start.isValid() || !end.isValid()) {
    return res
      .status(400)
      .json({ error: "Invalid startDateTime or endDateTime format" });
  }

  const filteredData = savingsData
    .filter((item) => {
      if (item.device_id !== parseInt(deviceId)) return false;
      try {
        let itemDate = moment(item.device_timestamp, moment.ISO_8601, true);
        if (!itemDate.isValid()) {
          itemDate = moment(item.device_timestamp);
        }
        if (!itemDate.isValid()) {
          console.warn(
            `Invalid timestamp for item: ${item.device_timestamp}, Device ID: ${deviceId}, Using UTC fallback`
          );
          itemDate = moment.utc(item.device_timestamp);
        }
        return itemDate.isBetween(start, end, null, "[]");
      } catch (e) {
        console.error(
          `Timestamp parsing error for ${item.device_timestamp}:`,
          e.message
        );
        return false;
      }
    })
    .map((item) => ({
      ...item,
      timestamp: item.device_timestamp,
    }));

  const totalCarbon =
    filteredData.reduce((sum, item) => sum + (item.carbon_saved || 0), 0) /
    1000;
  const totalFuel = filteredData.reduce(
    (sum, item) => sum + (item.fueld_saved || 0),
    0
  );

  const lastMonth = moment.tz(endDateTime, device.timezone).startOf("month");
  const lastMonthStr = lastMonth.format("YYYY-MM");
  const lastMonthData = filteredData.filter((item) => {
    const itemDate = moment(item.device_timestamp, moment.ISO_8601, true);
    if (!itemDate.isValid()) {
      itemDate = moment(item.device_timestamp);
    }
    const itemMonth = itemDate.startOf("month").format("YYYY-MM");
    return itemMonth === lastMonthStr && itemDate.isSameOrBefore(end);
  });

  let monthlyCarbon = 0,
    monthlyFuel = 0;
  if (lastMonthData.length > 0) {
    monthlyCarbon =
      lastMonthData.reduce((sum, item) => sum + (item.carbon_saved || 0), 0) /
      1000;
    monthlyFuel = lastMonthData.reduce(
      (sum, item) => sum + (item.fueld_saved || 0),
      0
    );
  }

  res.json({
    data: filteredData,
    totals: {
      totalCarbon,
      totalFuel,
      monthlyCarbon,
      monthlyFuel,
      lastMonth: lastMonthStr,
    },
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  await loadData();
  app
    .listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${port} is in use. Try a different port (e.g., 8081) by setting PORT environment variable.`
        );
      } else {
        console.error("Server error:", err.message);
      }
    });
}

startServer();
