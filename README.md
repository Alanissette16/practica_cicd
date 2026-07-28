# inventario-app

Catálogo de inventario con interfaz web y base de datos local. Este repositorio es el **punto de partida** de la tarea de CI/CD — no incluye `Dockerfile`, workflow de GitHub Actions ni manifiestos de Kubernetes: esos tres se construyen como parte del trabajo asignado.

## Qué es

Una app Node.js/Express con:

- **Interfaz web** (`public/index.html`, `public/app.js`, `public/styles.css`): una tabla de productos con formulario para agregar y botón para eliminar.
- **Base de datos local** (`db.js`): un archivo JSON en `data/products.json` que persiste los productos entre reinicios del proceso — sin motor de base de datos externo ni dependencias nativas.
- **API REST** consumida por la interfaz.

## Ejecutar en local

```bash
npm install
npm start
# abrir http://localhost:3000
```

## Pruebas

```bash
npm test
```

## Endpoints

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | Estado de salud: `200` si el proceso y el archivo de base de datos son accesibles, `500` si no (o si `SIMULATE_FAILURE=true`). |
| `GET /version` | Devuelve `version`, `color` y `hostname` — configurables por variables de entorno `APP_VERSION` / `APP_COLOR`. |
| `GET /api/products` | Lista todos los productos. |
| `GET /api/products/:id` | Devuelve un producto por id. |
| `POST /api/products` | Crea un producto (`name`, `sku`, `stock`, `price`). |
| `PATCH /api/products/:id` | Actualiza campos de un producto. |
| `DELETE /api/products/:id` | Elimina un producto. |
| `GET /` | Sirve la interfaz web. |

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor. |
| `APP_VERSION` | `v1` | Se muestra en `/version` y en el encabezado de la interfaz. |
| `APP_COLOR` | `blue` | Color del encabezado — útil para distinguir versiones en un despliegue. |
| `SIMULATE_FAILURE` | `false` | Si es `true`, `/health` responde siempre `500`. |
| `DB_PATH` | `./data/products.json` | Ruta del archivo de base de datos local. |

## Guía de Reproducción Paso a Paso de esta Práctica
### Paso 1: Verificar Funcionamiento Local

```bash
npm ci
```
Usamos npm ci en lugar de npm install porque el proyecto ya tiene un archivo package-lock.json. Este comando instala exactamente las versiones registradas en ese archivo, lo que ayuda a que el entorno local y GitHub Actions utilicen dependencias reproducibles.

![Install dependencias](/images/02-instalacion-dependencias.png)

```bash
npm test
```
Usamos npm test para ejecutar las pruebas del proyecto.

![alt text](/images/03-pruebas-locales-exitosas.png)

```bash
npm start
```
Sirve para iniciar la aplicación.

![alt text](/images/04-servidor-local-ejecutandose.png)
![Abrir Interfaz](/images/05-interfaz-local.png)
### Paso 2: Crear y Probar la Imagen Docker
**Archivo a crear `Dockerfile`:**
```dockerfile
# Instalar Dependencias
FROM node:22-alpine AS test
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Si las pruebas fallan, el build se detiene
RUN npm test

# Etapa final: ejecutar la app,
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY db.js ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```
**Archivo a crear `.dockerignore`:**
```.dockerignore
node_modules
npm-debug.log*
.git
.github
k8s
.DS_Store
data/*.json
!data/.gitkeep
```
**Ejecución local en PowerShell:**
```powershell
# Construir la imagen
docker build -t inventario-app:local
# Comprobar la imagen
docker images inventario-app
# Ejecutar el contenedor
docker run -p 3000:3000 inventario-app:local
# Verificar contenedor activo
docker ps
```
**Verificar Rutas:**
```powershell
# RUTA PRINCIPAL
curl.exe -s http://localhost:3000/ | Select-String "<title>"
# HEALTH
curl.exe -s http://localhost:3000/health
# VERSION 
curl.exe -s http://localhost:3000/version
# PRODUCTOS 
curl.exe -s http://localhost:3000/api/products
```
![alt text](/images/13-endpoints-desde-docker.png)
### Paso 3: Crear el pipeline de GitHub Actions
**Archivo `.github/workflows/ci-cd.yml` base:**
```yaml
name: ci-cd

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: alanissette16/practica_cicd

jobs:
  build-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Instalar dependencias (build reproducible)
        run: npm ci

      - name: Ejecutar pruebas
        run: npm test

  build-push:
    needs: build-test
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Login en GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build y push de la imagen (build once, promote many)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
```
**Despliegue al repositorio:**
```powershell
git add .github/workflows/ci-cd.yml
git commit -m "pipeline corregiddo"
git push
```
***Verificación:** Se verá primero build-test corriendo, y cuando termina en verde, build-push arranca solo. Al finalizar, los jobs `build-test` y `build-push` estarán en verde y la imagen aparecerá en la sección "Packages" en su perfil.*
![alt text](/images/PipelineSummary.png)
### Paso 4: Minikube con Rolling Update y Despliegue
**Archivo `k8s/deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cicd-practica-sd
  labels:
    app: cicd-practica-sd
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: cicd-practica-sd
  template:
    metadata:
      labels:
        app: cicd-practica-sd
    spec:
      containers:
        - name: app
          image: ghcr.io/alanissette16/practica_cicd:latest
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 2
            periodSeconds: 3
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
```
**Archivo `k8s/service.yaml`:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: cicd-practica-sd
spec:
  type: NodePort
  selector:
    app: cicd-practica-sd
  ports:
    - port: 80
      targetPort: 3000
```
**Despliegue y verificación (PowerShell):**
```powershell
# Crear el Clúster Local
minikube start --driver=docker
#Comprobar Estado
minikube status
# Desplegar en el clúster local
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
# Confirmar el estado del despliegue
kubectl rollout status deployment/cicd-practica-sd
# Exponer servicio para obtener la URL
minikube service cicd-practica-sd --url
```
![alt text](/images/16-rollout-kubernetes-exitoso.png)
### Paso 5: Prueba Al Eliminar un Pod
```powershell
# Lista los pods
kubectl get pods
# Interfaz de un Pod
kubectl port-forward pod/$POD 3001:3000
# Elimina Pod Especifico
kubectl delete pod $POD
```
![alt text](</images/17-listado de pods-ingreso-interfaz-pod.png>)
![alt text](/images/18-interfaz-pod.png)
![alt text](/images/19-eliminacion-pod.png)
![alt text](/images/20-nuevo-pod.png)
![alt text](/images/21-interfaz-Nuevo-pod.png)
Al eliminar el pod, también desaparece su archivo local.
### Paso 6: Elegir Blue-Green o Canary
Se opto utilizar la estrategia Blue-Green porque permite mantener dos versiones independientes de la aplicación ejecutándose al mismo tiempo y cambiar el tráfico de una a otra mediante el selector de un Service.
### Paso 7 y 8: Implementar Manifiestos y Demostrar Blue-Green
```powershell
# Obtener Hashes completos
$BLUE_SHA = git rev-parse 4a8ce93
$GREEN_SHA = git rev-parse 778feed
# Mostrar Hashes
Write-Host "BLUE:  $BLUE_SHA"
Write-Host "GREEN: $GREEN_SHA"
# Verificar Imagen de Blue y Green
docker pull ghcr.io/alanissette16/practica_cicd:HASH_COMPLETO_BLUE
docker pull ghcr.io/alanissette16/practica_cicd:HASH_COMPLETO_GREEN
```
![alt text](/images/Hash_Green-Blue.png)
**Manifiestos Blue-Green:**
```powershell
# Crear carpeta blue-green
New-Item -ItemType Directory -Force k8s\blue-green
# Creación de los archivos
New-Item -ItemType File -Force k8s\blue-green\blue-deployment.yaml
New-Item -ItemType File -Force k8s\blue-green\green-deployment.yaml
New-Item -ItemType File -Force k8s\blue-green\service.yaml
```
**Archivo `k8s/blue-green/blue-deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: cicd-practica-sd-blue
  labels:
    app: cicd-practica-sd-bg
    track: blue

spec:
  replicas: 2

  selector:
    matchLabels:
      app: cicd-practica-sd-bg
      track: blue

  template:
    metadata:
      labels:
        app: cicd-practica-sd-bg
        track: blue

    spec:
      containers:
        - name: app
          image: ghcr.io/alanissette16/practica_cicd:4a8ce933cae79f1b1f1310daf03eee6c59749fd9

          ports:
            - containerPort: 3000

          env:
            - name: PORT
              value: "3000"

            - name: APP_VERSION
              value: "v1"

            - name: APP_COLOR
              value: "blue"

          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 2
            periodSeconds: 3
            failureThreshold: 3

          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10

          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
```
**Archivo `k8s/blue-green/green-deployment.yaml`:**
```yaml
apiVersion: apps/v1
kind: Deployment

metadata:
  name: cicd-practica-sd-green
  labels:
    app: cicd-practica-sd-bg
    track: green

spec:
  replicas: 2

  selector:
    matchLabels:
      app: cicd-practica-sd-bg
      track: green

  template:
    metadata:
      labels:
        app: cicd-practica-sd-bg
        track: green

    spec:
      containers:
        - name: app
          image: ghcr.io/alanissette16/practica_cicd:778feed9699112c035c474f850dd300f9e77b9fc

          ports:
            - containerPort: 3000

          env:
            - name: PORT
              value: "3000"

            - name: APP_VERSION
              value: "v2"

            - name: APP_COLOR
              value: "green"

          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 2
            periodSeconds: 3
            failureThreshold: 3

          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10

          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "200m"
              memory: "128Mi"
```
**Archivo `k8s/blue-green/service.yaml`:**
```yaml
apiVersion: v1
kind: Service

metadata:
  name: cicd-practica-sd-bg

spec:
  type: NodePort

  selector:
    app: cicd-practica-sd-bg
    track: blue

  ports:
    - port: 80
      targetPort: 3000
```
```powershell
# Aplicar los 3 archivos en Minikube
kubectl apply -f k8s/blue-green/
# Verificar los deployments
kubectl rollout status deployment/cicd-practica-sd-blue
kubectl rollout status deployment/cicd-practica-sd-green
# Verificar las replicas de los deployments
kubectl get deployments
# Verificar los pods Blue y Green
kubectl get pods -l app=cicd-practica-sd-bg -L track
# Verificar que el Service apunta a Blue
kubectl get service cicd-practica-sd-bg -o jsonpath="{.spec.selector}"
# Obtener la dirección del Service
minikube service cicd-practica-sd-bg --url
```
***Importante:** Mientras se muestra la url en una terminal, abrir otra termianal y ejecutar este otro comando, cambiando a la url que les salió:*
```powershell
curl.exe http://127.0.0.1:53186/version
```
![alt text](/images/Antes-Selector-Service.png)
![alt text](/images/Curl-Blue.png)
***Importante:** En otra terminal, sin cerrar la terminal de minikube service, ejecuta:*
```powershell
# Parcheo dinámico del servicio para el switch de tráfico
'{"spec":{"selector":{"track":"green"}}}' | Out-File patch.json -Encoding utf8
kubectl patch service cicd-practica-sd-bg --type=merge --patch-file patch.json
Remove-Item patch.json
# Verificar que el Service apunta a Green
kubectl get service cicd-practica-sd-bg -o jsonpath="{.spec.selector}"
```
![alt text](/images/Despues-Green-Selector.png)
### Componentes Adicionales
**1. Manejo de secretos:**
```powershell
# Crear una API_KEY ficticia
$API_KEY = [guid]::NewGuid().ToString()
# Crear el Secret en Kubernetes
kubectl create secret generic inventario-app-secret --from-literal="API_KEY=$API_KEY" --dry-run=client -o yaml | kubectl apply -f -
# Eliminar la variable temporal
Remove-Variable API_KEY
# Verificar el Secret sin mostrar su valor
kubectl get secret inventario-app-secret
kubectl describe secret inventario-app-secret
```
![alt text](/images/Crear-Secret.png)
**Conectar el Secret al Deployment Blue:**

**Agregar debajo de `APP_COLOR` en el archivo `k8s/blue-green/blue-deployment.yaml`y lo mismo para el archivo `k8s/blue-green/green-deployment.yaml`:**
```yaml
  - name: API_KEY
    valueFrom:
      secretKeyRef:
        name: inventario-app-secret
        key: API_KEY
```

```powershell
# Aplicar los cambios de los 2 Deployments
kubectl apply -f k8s/blue-green/blue-deployment.yaml
kubectl apply -f k8s/blue-green/green-deployment.yaml
# Verificar los deployments
kubectl rollout status deployment/cicd-practica-sd-blue
kubectl rollout status deployment/cicd-practica-sd-green
```
**2. Readiness realista con arranque lento:**

**Agregar debajo de const SIMULATE_FAILURE en el archivo `server.js`:**
```js
const startupDelayValue = Number.parseInt(
  process.env.STARTUP_DELAY_SECONDS || '0',
  10
);

const STARTUP_DELAY_SECONDS =
  Number.isFinite(startupDelayValue) && startupDelayValue > 0
    ? startupDelayValue
    : 0;

const STARTED_AT = Date.now(); 
```

**Modificar la ruta `health` en el archivo `server.js`:**
```js
app.get('/health', (req, res) => {
  const elapsedSeconds = Math.floor((Date.now() - STARTED_AT) / 1000);

  if (elapsedSeconds < STARTUP_DELAY_SECONDS) {
    return res.status(503).json({
      status: 'starting',
      reason: 'la aplicación todavía está iniciando',
      elapsedSeconds,
      startupDelaySeconds: STARTUP_DELAY_SECONDS
    });
  }

  if (SIMULATE_FAILURE || !db.canAccessDb()) {
    return res.status(500).json({
      status: 'error',
      reason: 'fallo simulado o base de datos no accesible'
    });
  }

  return res.status(200).json({ status: 'ok' });
});
```
**Ejecutar las pruebas automáticas**
```powershell
npm test
```
![verifica que el cambio en /health](/images/Verificar-health.png)
**Probar manualmente el arranque lento**
```powershell
$env:STARTUP_DELAY_SECONDS = "30"
$env:PORT = "3003"
npm start
```
En otra terminal probar
```powershell
curl.exe -i http://localhost:3003/health
```
![Evidencia](/images/Arranque-Lento.png)
Primeros 30 segundos → 503, todavía no lista
Después de 30 segundos → 200, lista para recibir tráfico
**Configurar el arranque lento en el Deployment Blue**
**Agrega la variable de entorno:**
Dentro de env:, debajo de APP_COLOR, agrega:
```yaml
- name: STARTUP_DELAY_SECONDS
  value: "30"
```
La sección debe quedar así:
```yaml
env:
  - name: PORT
    value: "3000"

  - name: APP_VERSION
    value: "v1"

  - name: APP_COLOR
    value: "blue"

  - name: STARTUP_DELAY_SECONDS
    value: "30"

  - name: API_KEY
    valueFrom:
      secretKeyRef:
        name: inventario-app-secret
        key: API_KEY
```
**Ajusta el `readinessProbe`:**
Reemplaza el bloque actual por:
```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 3
  timeoutSeconds: 1
  failureThreshold: 12
  successThreshold: 1
```
**Ajusta el `livenessProbe`:**
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 40
  periodSeconds: 10
  timeoutSeconds: 1
  failureThreshold: 3
```
Readiness falla → el pod no recibe tráfico.
Liveness falla → Kubernetes puede reiniciar el contenedor.
**Configurar el arranque lento en el Deployment Green, con los mismos pasos deel Deployment Blue**
Subir los cambios al github hasta este momento para que se genere un nuevo Hash.
Cuando esten en verde ambos build.

Ejecutar esta linea de codigo en la terminal:
```powershell
git rev-parse HEAD
```
**Actualizar temporalmente las imágenes de Blue y Green**
```yaml
image: ghcr.io/alanissette16/practica_cicd:b6578ba1e28afee6324f62286d294bcc5eb8dee1
```
Terminal 1: observar los pods Green
```powershell
kubectl get pods -l "app=cicd-practica-sd-bg,track=green" -w
```
Terminal 2: aplicar Green
```powershell
kubectl apply -f k8s/blue-green/green-deployment.yaml
```
![Salida](/images/Readiness.png)
```powershell
kubectl rollout status deployment/cicd-practica-sd-green
```

## Readiness realista con arranque lento

Se agregó la variable de entorno STARTUP_DELAY_SECONDS con un valor de 30 segundos. Durante ese tiempo, la ruta /health responde con el código HTTP 503 y el estado starting, simulando que la aplicación todavía está conectándose a una base de datos.

El readinessProbe consulta la ruta /health periódicamente. Mientras recibe una respuesta 503, el contenedor permanece ejecutándose, pero el pod aparece como 0/1 Ready y Kubernetes no lo agrega a los endpoints del Service. Cuando finalizan los 30 segundos, /health responde con código 200 y el pod cambia a 1/1 Ready.

También se retrasó el livenessProbe para evitar que el contenedor sea reiniciado durante un arranque normal. El readinessProbe no elimina ni reinicia el pod; únicamente evita que reciba tráfico. El livenessProbe sí puede provocar el reinicio del contenedor cuando detecta fallos consecutivos.

Aumentar solamente el número de réplicas no solucionaría una configuración incorrecta de las sondas. Todas las réplicas podrían permanecer no listas durante el mismo periodo o reiniciarse si el livenessProbe se ejecuta demasiado pronto. Esto aumentaría el consumo de CPU y memoria, pero no corregiría la causa del problema. Las réplicas aportan capacidad y redundancia, mientras que las sondas determinan cuándo cada pod está realmente preparado para recibir tráfico.

**3. Escaneo de seguridad en el pipeline:**

Construir imagen local → escanear con Trivy → publicar en GHCR

**Modificar el job build-push del archivo `ci-cd.yml`**
```yaml
  build-push:
    needs: build-test
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Construir imagen local
        run: |
          docker build \
            -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest \
            .

      - name: Escanear vulnerabilidades CRITICAL con Trivy
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: table
          scanners: vuln
          severity: CRITICAL
          exit-code: '1'

      - name: Login en GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Publicar imagen con hash
        run: |
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

      - name: Publicar imagen latest
        run: |
          docker push ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
```
Subir los cambios a github
```powershell
git add .
git commit -m "texto"
git push
```
![alt text](/images/Trivy-funcionando.png)
Hay un paquete tar que genero el error
Se elimina el npm global
**Modificar el archivo `Dockerfile`**
```dockerfile
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/bin/npm \
              /usr/local/bin/npx
```
**Construir la imagen corregida localmente**
```powershell
 docker build -t inventario-app:trivy-fix .
```
Subir los cambios a github
```powershell
git add .
git commit -m "texto"
git push
```
![alt text](/images/tar-eliminado-Actions-bien.png)
