import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WeatherApp } from "@/components/weather/WeatherApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), 1100);
    return () => window.clearTimeout(id);
  }, []);
  if (!on) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">
          <p className="boot-en">MyWeather</p>
          <p className="boot-by">By NabdhServ.net</p>
        </div>
      </main>
    );
  }
  return <WeatherApp />;
}
