import webview
import os
import subprocess

# Запуск Node.js сервера
server = subprocess.Popen(['node', 'server.js'])

# Открытие WebView
def start_webview():
    webview.create_window('CrewApp 1.0', 'http://localhost:3000', width=1200, height=800)
    webview.start()

if __name__ == '__main__':
    start_webview()