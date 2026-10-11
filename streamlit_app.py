import os
import requests
import streamlit as st

st.set_page_config(
    page_title="IBVAP | Border Video Analytics",
    page_icon="🛡️",
    layout="wide",
)

st.title("🛡️ Intelligent Border Video Analytics Platform")
st.caption("Live telemetry dashboard")

st.warning(
    "Cloud dashboard: live telemetry only. "
    "Evidence, raw footage, and logs remain outside this app."
)

st.sidebar.header("Connection")

try:
    api_url = st.secrets["IBVAP_API_URL"].rstrip("/")
    access_id = st.secrets["CF_ACCESS_CLIENT_ID"]
    access_secret = st.secrets["CF_ACCESS_CLIENT_SECRET"]
except Exception:
    st.error(
        "Connection settings are not configured yet. "
        "Complete the deployment secrets setup before connecting."
    )
    st.stop()

headers = {
    "CF-Access-Client-Id": access_id,
    "CF-Access-Client-Secret": access_secret,
}

if st.button("Refresh telemetry"):
    st.rerun()

try:
    response = requests.get(
        f"{api_url}/api/telemetry",
        headers=headers,
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()

    st.success("Telemetry endpoint connected")

    col1, col2, col3 = st.columns(3)

    col1.metric("Camera", str(data.get("cameraState", "Unknown")))
    col2.metric("FPS", f"{float(data.get('fps', 0)):.2f}")
    col3.metric(
        "YOLO inference",
        f"{float(data.get('yoloMs', 0)):.2f} ms",
    )

    st.subheader("Detection telemetry")
    detections = data.get("detections", [])

    st.metric("Detected objects", len(detections))

    if detections:
        st.dataframe(detections, use_container_width=True)
    else:
        st.info("No detections reported in the latest telemetry.")

    st.caption("This dashboard does not save camera frames or evidence.")

except requests.RequestException:
    st.error(
        "Could not reach the protected IBVAP backend. "
        "Check that the local engine, bridge, and secure tunnel are running."
    )
except (ValueError, TypeError):
    st.error("The backend returned telemetry in an unexpected format.")
