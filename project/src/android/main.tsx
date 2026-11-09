import { createRoot } from 'react-dom/client';
import { WeatherApp } from '../components/weather/WeatherApp';
import '../styles.css';

createRoot(document.getElementById('root')!).render(<WeatherApp />);
