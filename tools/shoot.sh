#!/bin/sh
# Съёмка ролика без окна: Chrome в фоне с чистым профилем открывает сцену с ?shoot, та снимает себя по раскадровке из tools/shoot.js.
# Нужен запущенный dev-сервер (npm run dev). Запуск из корня проекта: sh tools/shoot.sh, потом склейка: sh tools/reel.sh
rm -rf shots/reel
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir="$(mktemp -d)" --window-size=1080,1920 --no-first-run "http://localhost:${PORT:-3941}/?shoot" >/dev/null 2>&1 &
pid=$!
until [ -f shots/reel/audio.wav ]; do sleep 2; done # звук пишется последним
sleep 1; kill $pid
echo "кадров: $(ls shots/reel/f-*.jpg | wc -l)"
