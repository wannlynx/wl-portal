$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/petroleum'
$env:PGSSL = 'disable'
$env:PETROLEUM_SECRET_KEY = 'local-dev-secret'
$env:OPIS_USERNAME = 'ram@xprotean.com'
$env:OPIS_PASSWORD = 'wp5MQfPTkvVPST!'

Set-Location 'C:\Users\deepa\source\repos\Petroleum\apps\api'
node src/server.js
