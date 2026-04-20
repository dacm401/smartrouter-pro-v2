/**
 * 天气搜索 — O-008
 * 使用 wttr.in 免费 API 获取实时天气数据
 * 无需 API key，直接 HTTP 调用
 */

// ── 天气查询检测 ─────────────────────────────────────────────────────────────

const WEATHER_PATTERNS = [
  /天气$/, /气温$/, /温度$/, /下雨/, /下雪/, /晴天/, /阴天/, /降温/, /升温/,
  /会下雨吗/, /会下雪吗/, /有雨吗/, /有雪吗/, /要带伞吗/,
  /weather/i, /temperature/i, /rain/i, /snow/i,
];

const CITY_PATTERN = /([\u4e00-\u9fff]{2,8}?(?:市|区|县|省|城)?)/g;

/**
 * 检测消息是否为天气查询，返回城市名（如有）或 null
 */
export function detectWeatherQuery(message: string): string | null {
  if (!WEATHER_PATTERNS.some((p) => p.test(message))) return null;
  const cities = message.match(CITY_PATTERN);
  return cities?.[0]?.replace(/[市市区县省城]$/, "") || null;
}

// ── 天气 API ─────────────────────────────────────────────────────────────────

export interface WeatherData {
  city: string;
  temp: string;
  condition: string;
  humidity: string;
  wind: string;
  feelsLike: string;
  tomorrow?: { condition: string; temp: string; };
}

const WTXR_API = "https://wttr.in";

/**
 * 从 wttr.in 获取实时天气
 * @param city 城市名（中文或拼音），为空则返回默认位置
 */
export async function fetchRealTimeWeather(city?: string): Promise<WeatherData | null> {
  const location = city ? `${encodeURIComponent(city)}:` : "";
  const url = `${WTXR_API}/${location}?format=j1`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const data = await resp.json() as any;

    const current = data.current_condition?.[0];
    if (!current) return null;

    const mapCondition = (code: string): string => {
      const c = parseInt(code);
      if (c === 113) return "晴天";
      if (c === 116) return "多云";
      if (c === 119 || c === 122) return "阴天";
      if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 353, 355, 356, 359, 365, 374, 377].includes(c)) return "有雨";
      if ([386, 389, 392].includes(c)) return "雷阵雨";
      if ([227, 230, 248, 260, 320, 362, 371, 377, 378, 379].includes(c)) return "有雪";
      return "天气未知";
    };

    const result: WeatherData = {
      city: city || data.nearest_area?.[0]?.areaName?.[0]?.value || "当前地区",
      temp: current.temp_C + "°C",
      condition: mapCondition(current.weatherCode),
      humidity: current.humidity + "%",
      wind: current.windspeedKmph + " km/h " + (current.winddir16Point || ""),
      feelsLike: current.FeelsLikeC + "°C",
    };

    // 明天预报（如果有）
    const tomorrow = data.weather?.[1];
    if (tomorrow) {
      result.tomorrow = {
        condition: mapCondition(tomorrow.hourly?.[4]?.weatherCode || "116"),
        temp: `${tomorrow.mintempC}~${
          tomorrow.maxtempC}°C`,
      };
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * 将 WeatherData 格式化为字符串，用于注入到 prompt 中
 */
export function formatWeatherPrompt(data: WeatherData, userMessage: string): string {
  let text = `【实时天气数据】（来源：wttr.in）\n`;
  text += `城市：${data.city}\n`;
  text += `当前天气：${data.condition}，气温 ${data.temp}（体感 ${data.feelsLike}）\n`;
  text += `湿度：${data.humidity}，风速：${data.wind}\n`;
  if (data.tomorrow) {
    text += `明天预报：${data.tomorrow.condition}，气温 ${data.tomorrow.temp}\n`;
  }
  return text;
}
