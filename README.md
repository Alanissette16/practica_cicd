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
