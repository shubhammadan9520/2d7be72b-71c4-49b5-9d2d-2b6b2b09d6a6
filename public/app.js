const { createApp } = Vue;

createApp({
  data() {
    return {
      devices: [],
      selectedDevice: null,
      startDateTime: "2023-01-01T00:00",
      endDateTime: "2024-01-01T23:59",
      data: [],
      totals: {
        totalCarbon: 0,
        totalFuel: 0,
        monthlyCarbon: 0,
        monthlyFuel: 0,
        lastMonth: null,
      },
      chart: null,
    };
  },
  async mounted() {
    if (typeof echarts === "undefined") {
      console.error("ECharts is not loaded");
      return;
    }
    const chartContainer = document.getElementById("chart");
    if (!chartContainer) {
      console.error("Chart container not found");
      return;
    }
    this.chart = echarts.init(chartContainer, null, { renderer: "svg" });
    if (!this.chart) {
      console.error("Chart initialization failed - check if ECharts loaded");
      return;
    }
    await this.fetchDevices();
    if (this.devices.length > 0) {
      this.selectedDevice = this.devices[0].id;
      await this.fetchData();
    }
  },
  methods: {
    async fetchDevices() {
      try {
        const response = await fetch("/api/devices");
        this.devices = await response.json();
      } catch (error) {
        console.error("Error fetching devices:", error.message);
        alert("Failed to load devices");
      }
    },
    async fetchData() {
      if (!this.selectedDevice) {
        alert("Please select a device");
        return;
      }
      try {
        const response = await fetch(
          `/api/savings?deviceId=${this.selectedDevice}&startDateTime=${this.startDateTime}&endDateTime=${this.endDateTime}`
        );
        const result = await response.json();

        if (response.ok) {
          this.data = result.data || [];
          this.totals = result.totals || {
            totalCarbon: 0,
            totalFuel: 0,
            monthlyCarbon: 0,
            monthlyFuel: 0,
            lastMonth: null,
          };
          console.log(
            "Raw data fetched for device",
            this.selectedDevice,
            ":",
            this.data
          );
          this.renderChart();
        } else {
          alert(result.error || "Failed to load data");
        }
      } catch (error) {
        console.error("Error fetching data:", error.message);
        alert("Failed to load data");
      }
    },
    setDateRange(range) {
      const baseDate = new Date("2024-01-01T23:59:00+05:30");
      this.endDateTime = baseDate.toISOString().slice(0, 16);
      if (range === "last30") {
        this.startDateTime = new Date(baseDate.setDate(baseDate.getDate() - 30))
          .toISOString()
          .slice(0, 16);
      } else if (range === "last60") {
        this.startDateTime = new Date(baseDate.setDate(baseDate.getDate() - 60))
          .toISOString()
          .slice(0, 16);
      } else if (range === "lastYear") {
        this.startDateTime = new Date(
          baseDate.setFullYear(baseDate.getFullYear() - 1)
        )
          .toISOString()
          .slice(0, 16);
      }
      this.fetchData();
    },
    renderChart() {
      if (!this.chart) {
        console.error(
          "Chart not initialized. Ensure echarts.init() is called with a valid DOM element."
        );
        return;
      }

      if (!this.data || this.data.length === 0) {
        this.chart.setOption({
          title: { text: "No data available" },
          xAxis: [{ type: "category", data: [] }],
          yAxis: [{ type: "value" }],
          series: [{ type: "bar", data: [] }],
        });
        console.log("No data to render");
        return;
      }

      const monthlyData = {};
      const allMonths = new Set();

      this.data.forEach((item, index) => {
        try {
          if (!item || !item.timestamp) {
            console.warn(`Skipping invalid item at index ${index}:`, item);
            return;
          }
          let month;
          const parsed = moment(item.timestamp, moment.ISO_8601, true);
          if (parsed.isValid()) {
            month = parsed.tz("Asia/Kolkata").format("YYYY-MM");
          } else {
            console.warn(
              `Invalid timestamp at index ${index}: ${item.timestamp}`
            );
            month = moment(item.timestamp).format("YYYY-MM");
          }
          allMonths.add(month);
          if (!monthlyData[month]) {
            monthlyData[month] = { carbon: 0, fuel: 0, count: 0 };
          }

          const carbonValue = item.carbon_saved || 0;
          const fuelValue = item.fueld_saved || 0;
          monthlyData[month].carbon += carbonValue;
          monthlyData[month].fuel += fuelValue;
          monthlyData[month].count += 1;
        } catch (e) {
          console.error(
            `Error processing item at index ${index}:`,
            item,
            e.message
          );
        }
      });

      const xAxisData = Array.from(allMonths).sort();
      const carbonData = xAxisData.map((month) => {
        const avg =
          monthlyData[month].count > 0
            ? monthlyData[month].carbon / monthlyData[month].count
            : 0;
        return isNaN(avg) ? 0 : parseFloat(avg.toFixed(2));
      });
      const fuelData = xAxisData.map((month) => {
        const total = monthlyData[month].fuel;
        return isNaN(total) ? 0 : parseFloat(total.toFixed(2));
      });

      const option = {
        tooltip: { trigger: "axis" },
        legend: { data: ["Carbon Savings", "Diesel Savings"], bottom: 5 },
        xAxis: {
          type: "category",
          data: xAxisData,
          axisLabel: { rotate: 30 },
          boundaryGap: true,
        },
        yAxis: [
          { type: "value", position: "left", min: 0, name: "Carbon (Tonnes)" },
          { type: "value", position: "right", min: 0, name: "Fuel (Litres)" },
        ],
        dataZoom: [
          {
            type: "slider",
            show: true,
            xAxisIndex: 0,
            start: 0,
            end: 100,
            zoomLock: false,
          },
          {
            type: "inside",
            xAxisIndex: 0,
            start: 0,
            end: 100,
            zoomLock: false,
          },
        ],
        series: [
          {
            name: "Carbon Savings",
            type: "bar",
            yAxisIndex: 0,
            data: carbonData,
            itemStyle: { color: "#09e5b1" },
          },
          {
            name: "Diesel Savings",
            type: "bar",
            yAxisIndex: 1,
            data: fuelData,
            itemStyle: { color: "#4726c0" },
          },
        ],
      };

      try {
        const chartContainer = document.getElementById("chart");
        if (!chartContainer) {
          console.warn("Chart container not found");
          return;
        }

        if (this.chart) {
          this.chart.dispose();
        }

        this.chart = echarts.init(chartContainer);
        this.chart.setOption(option, true);
        this.chart.resize();
        console.log("Chart rendered successfully with monthly data");
      } catch (error) {
        console.error(
          "Error rendering chart:",
          error.message,
          "\nStack:",
          error.stack
        );
      }
    },
  },
}).mount("#app");
