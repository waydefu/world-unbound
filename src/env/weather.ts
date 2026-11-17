/** Weather states shared by the URL parameters, camera presets and lighting. */
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';
export const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'storm'];
/** Ground wetness (0 dry .. 1 soaked) driven by each weather state. */
export const WEATHER_WETNESS: Record<Weather, number> = { clear: 0, cloudy: 0.1, rain: 0.8, storm: 1 };
