# Kubernetes local con kind y Helm

Esta guía ejecuta OpsFlow dentro de un clúster Kubernetes local creado con kind. No crea recursos cloud ni expone puertos del clúster a la red: se accede a la interfaz con `kubectl port-forward`.

## Requisitos

- Docker Desktop con el motor Linux activo.
- `kind`, `kubectl` y Helm instalados.
- `.env` local creado siguiendo la guía principal.

## Crear clúster y namespace

```powershell
if ((kind get clusters) -notcontains 'opsflow') { kind create cluster --name opsflow }
kubectl create namespace opsflow --dry-run=client -o yaml | kubectl apply -f -
```

El contexto de `kubectl` apunta al clúster `kind-opsflow`. Los comandos siguientes indican el namespace explícitamente para que no dependan del namespace predeterminado del contexto.

## Crear el Secret local

Se reutiliza `.env` como fuente local. El archivo no se copia a la imagen ni se incluye en Helm:

```powershell
kubectl create secret generic opsflow-local --from-env-file=.env --namespace opsflow --dry-run=client -o yaml | kubectl apply -f -
```

El Secret de Kubernetes evita poner la contraseña en los manifiestos versionados. En un clúster local, el objeto no cifra por sí solo el secreto ni equivale a un gestor central como AWS Secrets Manager.

## Construir imágenes y cargarlas en kind

kind ejecuta los nodos como contenedores. Por eso las imágenes locales deben cargarse explícitamente en el clúster; un `docker build` del host por sí solo no garantiza que Kubernetes las encuentre.

```powershell
docker build -f apps/api/Dockerfile -t opsflow-api:kind-local .
docker build -f apps/web/Dockerfile -t opsflow-web:kind-local .
kind load docker-image opsflow-api:kind-local --name opsflow
kind load docker-image opsflow-web:kind-local --name opsflow
```

## Instalar o actualizar la aplicación

```powershell
helm upgrade --install opsflow ./deploy/helm/opsflow --namespace opsflow --create-namespace --values ./deploy/helm/values-kind.yaml
kubectl get pods,pvc,services,jobs --namespace opsflow
```

Helm instala PostgreSQL con un volumen persistente y ejecuta la migración como Job. En una instalación inicial, el Job corre después de crear los recursos para que PostgreSQL ya exista; en una actualización, corre antes de actualizar los Deployments. Los datos de demo se habilitan solo en `values-kind.yaml`. La API y la web se ejecutan en Deployments y se comunican mediante Services internos; la plantilla de Nginx recibe el resolvedor de kind y el nombre DNS completo de la API según el namespace.

## Abrir la interfaz y comprobar la API

En una terminal:

```powershell
kubectl port-forward --namespace opsflow service/web 8081:8080
```

Abre <http://opsflow.localhost:8081>. La API comparte el mismo origen a través del proxy de Nginx. El `port-forward` se mantiene activo mientras esa terminal siga abierta y hay que iniciarlo de nuevo después de recrear el Pod de web. Para revisar readiness desde otra terminal:

```powershell
Invoke-WebRequest http://127.0.0.1:8081/health/ready
```

## Inspección y recuperación

```powershell
kubectl get pods --namespace opsflow --watch
kubectl describe pod <nombre-del-pod> --namespace opsflow
kubectl logs deployment/api --namespace opsflow
kubectl get events --namespace opsflow --sort-by=.lastTimestamp
helm history opsflow --namespace opsflow
helm rollback opsflow <revision-anterior> --namespace opsflow
```

Si reemplazas una imagen local conservando la etiqueta `kind-local`, vuelve a construirla y cárgala con `kind load docker-image`. Como Kubernetes no detecta que cambió el contenido detrás de una etiqueta igual, reinicia los Deployments para que creen Pods nuevos:

```powershell
kubectl rollout restart deployment/api deployment/web --namespace opsflow
kubectl rollout status deployment/api --namespace opsflow
kubectl rollout status deployment/web --namespace opsflow
```

Para cambios en los valores o recursos del chart, ejecuta de nuevo `helm upgrade --install`.

## Limpiar el entorno local

```powershell
helm uninstall opsflow --namespace opsflow
kubectl delete namespace opsflow
kind delete cluster --name opsflow
```

La eliminación del namespace borra la PVC local y los datos de PostgreSQL del clúster de práctica.
