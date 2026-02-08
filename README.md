📺 OBS Overlay Tool
A simple, web-based control panel to manage professional graphics for your live stream or broadcast.

This tool allows you to control lower thirds, scoreboards, and timers in real-time. It’s designed for streamers who want professional overlays without the hassle of editing files manually during a broadcast.

🔥 Features
Live Lower Thirds: Easily show or hide name tags for your guests. Features two channels (Left & Right) and 8 slots to save your frequent guests for quick access.

Scoreboard: Keep your viewers updated with team names, scores, and club colors.

Built-in Match Clock: Start, stop, and reset a match timer directly from the panel.

Dynamic Countdown/up: Perfect for breaks or "Starting Soon" scenes, featuring a visual progress ring and custom background support.

Quick Branding (CI): Save your primary and secondary colors and apply them to all elements with a single click.

[Work in Progress] Bilingual: Switch the entire interface between English and German.

🚀 How to use it with OBS
Launch the App: Open the OBS Overlay Tool on your computer.

Add Browser Source: In OBS, create a new Browser Source with these settings:

URL: http://localhost:3000/overlay.html

Size: 1920 x 1080 (Full HD)

Control Live: Use the app window (Control Panel) to trigger animations, change names, or update the score. Everything updates instantly in OBS.

🛠️ For Developers & Tech-Savvy Users
If you want to run it from source or contribute:

Clone the repository.

Navigate to the app folder: cd app

Install dependencies: npm install

Run it: npm start

📂 Structure at a glance
app/: The core Electron application.

defaults/: Master templates for the server, control panel, overlays and translations.

📜 License
MIT License - Use it, change it, and have fun with your streams!
