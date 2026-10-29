{{- define "opsflow.labels" -}}
app.kubernetes.io/part-of: opsflow
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "opsflow.selectorLabels" -}}
app.kubernetes.io/part-of: opsflow
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
