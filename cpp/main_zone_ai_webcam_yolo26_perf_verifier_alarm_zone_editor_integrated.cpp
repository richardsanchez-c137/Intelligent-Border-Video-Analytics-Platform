#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>  // Beep() for the audible intrusion alarm
#include <iostream>
#include <atomic>
#include <thread>
#include <condition_variable>
#include <mutex>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <limits>
#include <chrono>
#include <ctime>
#include <fstream>
#include <filesystem>
#include <unordered_map>
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>
#include <opencv2/geometry/2d.hpp>
using namespace std;
using namespace cv;
using namespace cv::dnn;
// Interactive restricted-zone editor. Coordinates are normalized to the preview.
struct RestrictedZoneEditor {
    double x1 = 0.60, y1 = 0.15, x2 = 0.95, y2 = 0.85;
    double startX = 0.60, startY = 0.15, endX = 0.95, endY = 0.85;
    double originalX1 = 0.60, originalY1 = 0.15, originalX2 = 0.95, originalY2 = 0.85;
    bool editing = false;
    bool dragging = false;
    bool hasDraft = false;
};
static RestrictedZoneEditor gZoneEditor;
static constexpr int PREVIEW_WIDTH = 1280;
static constexpr int PREVIEW_HEIGHT = 800;
static double clampZoneCoordinate(double v) {
    return std::max(0.0, std::min(1.0, v));
}
static void restrictedZoneMouseCallback(int event, int x, int y, int, void*) {
    if (!gZoneEditor.editing) return;
    const double nx = clampZoneCoordinate(static_cast<double>(x) / PREVIEW_WIDTH);
    const double ny = clampZoneCoordinate(static_cast<double>(y) / PREVIEW_HEIGHT);
    if (event == cv::EVENT_LBUTTONDOWN) {
        gZoneEditor.dragging = true;
        gZoneEditor.hasDraft = true;
        gZoneEditor.startX = nx; gZoneEditor.startY = ny;
        gZoneEditor.endX = nx; gZoneEditor.endY = ny;
    } else if (event == cv::EVENT_MOUSEMOVE && gZoneEditor.dragging) {
        gZoneEditor.endX = nx; gZoneEditor.endY = ny;
    } else if (event == cv::EVENT_LBUTTONUP && gZoneEditor.dragging) {
        gZoneEditor.endX = nx; gZoneEditor.endY = ny;
        gZoneEditor.dragging = false;
        gZoneEditor.x1 = std::min(gZoneEditor.startX, gZoneEditor.endX);
        gZoneEditor.y1 = std::min(gZoneEditor.startY, gZoneEditor.endY);
        gZoneEditor.x2 = std::max(gZoneEditor.startX, gZoneEditor.endX);
        gZoneEditor.y2 = std::max(gZoneEditor.startY, gZoneEditor.endY);
        gZoneEditor.hasDraft = true;
    }
}
static bool loadRestrictedZone(const std::string& path, RestrictedZoneEditor& z) {
    std::ifstream in(path);
    if (!in) return false;
    double x1, y1, x2, y2;
    if (!(in >> x1 >> y1 >> x2 >> y2)) return false;
    x1 = clampZoneCoordinate(x1); y1 = clampZoneCoordinate(y1);
    x2 = clampZoneCoordinate(x2); y2 = clampZoneCoordinate(y2);
    if (x2 - x1 < 0.01 || y2 - y1 < 0.01) return false;
    z.x1 = x1; z.y1 = y1; z.x2 = x2; z.y2 = y2;
    return true;
}
static bool saveRestrictedZone(const std::string& path, const RestrictedZoneEditor& z) {
    const std::filesystem::path configPath(path);
    if (!configPath.parent_path().empty()) {
        std::filesystem::create_directories(configPath.parent_path());
    }
    std::ofstream out(path, std::ios::trunc);
    if (!out) return false;
    out << std::fixed << std::setprecision(6)
        << z.x1 << ' ' << z.y1 << ' ' << z.x2 << ' ' << z.y2 << '\n';
    return static_cast<bool>(out);
}
// NanoDet class IDs from the COCO dataset.
string targetClassName(int id) {
    switch (id) {
        case 0: return "Person";
        case 1: return "Bicycle";
        case 2: return "Car";
        case 3: return "Motorcycle";
        case 5: return "Bus";
        case 6: return "Train";
        case 7: return "Truck";
        default: return "";
    }
}
struct IoUTrack {
    int id;
    int classId;
    cv::Rect box;
    float confidence;
    int missedFrames;
    // Estimated centre velocity in original-frame pixels per frame.
    double velocityX = 0.0;
    double velocityY = 0.0;
};
// Tracks intrusion state separately for every persistent object ID.
struct IntrusionTrackState {
    bool active = false;
    chrono::steady_clock::time_point lastSeen{};
    // Last observed ground-contact point helps bridge brief ID switches.
    cv::Point2d lastFoot{};
};
// Measure how much two bounding boxes overlap.
double calculateIoU(const cv::Rect& a, const cv::Rect& b) {
    const cv::Rect intersection = a & b;
    const double intersectionArea = static_cast<double>(intersection.area());
    const double unionArea = static_cast<double>(a.area()) + b.area() - intersectionArea;
    if (unionArea <= 0.0) {
        return 0.0;
    }
    return intersectionArea / unionArea;
}
// Return the fraction of a detected bounding box that overlaps the restricted
// polygon. This allows an alarm as soon as a verified person's box enters the
// zone, rather than waiting for the bottom-centre/feet point to cross its edge.
// The current zone is a convex rectangle.
double boundingBoxOverlapRatio(const cv::Rect& box, const std::vector<cv::Point>& polygon) {
    if (box.empty() || polygon.size() < 3) return 0.0;
    std::vector<cv::Point2f> zonePoints;
    zonePoints.reserve(polygon.size());
    for (const auto& p : polygon) {
        zonePoints.emplace_back(static_cast<float>(p.x), static_cast<float>(p.y));
    }
    const float left = static_cast<float>(box.x);
    const float top = static_cast<float>(box.y);
    const float right = static_cast<float>(box.x + box.width);
    const float bottom = static_cast<float>(box.y + box.height);
    const std::vector<cv::Point2f> boxPolygon = {
        cv::Point2f(left, top), cv::Point2f(right, top),
        cv::Point2f(right, bottom), cv::Point2f(left, bottom)
    };
    std::vector<cv::Point2f> intersectionPolygon;
    const double intersectionArea = cv::intersectConvexConvex(
        zonePoints, boxPolygon, intersectionPolygon
    );
    if (!std::isfinite(intersectionArea) || intersectionArea <= 0.0) return 0.0;
    return intersectionArea / std::max(1.0, static_cast<double>(box.area()));
}
// Greedy motion-aware tracker. It predicts a track's centre using its recent
// velocity, then combines predicted-centre proximity with box overlap. This
// is still a lightweight tracker (not appearance-based identity recognition).
std::vector<int> updateIoUTracks(
    std::vector<IoUTrack>& tracks,
    const std::vector<cv::Rect>& detectionBoxes,
    const std::vector<int>& detectionClassIds,
    const std::vector<float>& detectionConfidences,
    int& nextTrackId
) {
    const size_t existingTrackCount = tracks.size();
    const size_t detectionCount = detectionBoxes.size();
    std::vector<int> detectionTrackIds(detectionCount, -1);
    struct Candidate {
        double score;
        size_t trackIndex;
        size_t detectionIndex;
    };
    std::vector<Candidate> candidates;
    for (size_t t = 0; t < existingTrackCount; ++t) {
        const IoUTrack& track = tracks[t];
        const cv::Rect& oldBox = track.box;
        const double oldCenterX = oldBox.x + oldBox.width / 2.0;
        const double oldCenterY = oldBox.y + oldBox.height / 2.0;
        // Limit extrapolation; bounding-box motion is only an approximation.
        const double predictionFrames = std::min(track.missedFrames + 1, 5);
        const double predictedCenterX = oldCenterX + track.velocityX * predictionFrames;
        const double predictedCenterY = oldCenterY + track.velocityY * predictionFrames;
        const cv::Rect predictedBox(
            static_cast<int>(std::lround(predictedCenterX - oldBox.width / 2.0)),
            static_cast<int>(std::lround(predictedCenterY - oldBox.height / 2.0)),
            oldBox.width,
            oldBox.height
        );
        for (size_t d = 0; d < detectionCount; ++d) {
            if (track.classId != detectionClassIds[d]) {
                continue;
            }
            const cv::Rect& newBox = detectionBoxes[d];
            const double newCenterX = newBox.x + newBox.width / 2.0;
            const double newCenterY = newBox.y + newBox.height / 2.0;
            const double dx = newCenterX - predictedCenterX;
            const double dy = newCenterY - predictedCenterY;
            const double centerDistance = std::hypot(dx, dy);
            const double iouNow = calculateIoU(oldBox, newBox);
            const double iouPredicted = calculateIoU(predictedBox, newBox);
            const double bestIoU = std::max(iouNow, iouPredicted);
            const double largestDimension = std::max({
                static_cast<double>(oldBox.width),
                static_cast<double>(oldBox.height),
                static_cast<double>(newBox.width),
                static_cast<double>(newBox.height)
            });
            // Human boxes can shift substantially while pose/shape changes.
            // A broader, scale-aware gate is more tolerant than IoU alone.
            // More tolerant gate for pose changes and intermittent detections.
            const double maxCenterDistance = std::max(220.0, 1.25 * largestDimension);
            if (centerDistance > maxCenterDistance && bestIoU < 0.05) {
                continue;
            }
            const double proximity = 1.0 - std::min(
                centerDistance / maxCenterDistance, 1.0
            );
            // Prefer a close predicted centre, while still rewarding overlap.
            // Prefer recently observed tracks when scores are otherwise similar.
            const double agePenalty = 0.0005 * track.missedFrames;
            const double score = 0.70 * proximity + 0.30 * bestIoU - agePenalty;
            candidates.push_back({score, t, d});
        }
    }
    std::sort(candidates.begin(), candidates.end(),
        [](const Candidate& a, const Candidate& b) {
            return a.score > b.score;
        });
    std::vector<bool> trackMatched(existingTrackCount, false);
    std::vector<bool> detectionMatched(detectionCount, false);
    for (const Candidate& candidate : candidates) {
        const size_t t = candidate.trackIndex;
        const size_t d = candidate.detectionIndex;
        if (trackMatched[t] || detectionMatched[d]) {
            continue;
        }
        IoUTrack& track = tracks[t];
        const double oldCenterX = track.box.x + track.box.width / 2.0;
        const double oldCenterY = track.box.y + track.box.height / 2.0;
        const double newCenterX = detectionBoxes[d].x + detectionBoxes[d].width / 2.0;
        const double newCenterY = detectionBoxes[d].y + detectionBoxes[d].height / 2.0;
        const double elapsedFrames = std::max(1, track.missedFrames + 1);
        const double measuredVelocityX = (newCenterX - oldCenterX) / elapsedFrames;
        const double measuredVelocityY = (newCenterY - oldCenterY) / elapsedFrames;
        // Smooth noisy frame-to-frame movement estimates.
        track.velocityX = 0.60 * track.velocityX + 0.40 * measuredVelocityX;
        track.velocityY = 0.60 * track.velocityY + 0.40 * measuredVelocityY;
        track.box = detectionBoxes[d];
        track.confidence = detectionConfidences[d];
        track.missedFrames = 0;
        detectionTrackIds[d] = track.id;
        trackMatched[t] = true;
        detectionMatched[d] = true;
    }
    for (size_t t = 0; t < existingTrackCount; ++t) {
        if (!trackMatched[t]) {
            ++tracks[t].missedFrames;
            tracks[t].velocityX *= 0.90;
            tracks[t].velocityY *= 0.90;
        }
    }
    for (size_t d = 0; d < detectionCount; ++d) {
        if (detectionMatched[d]) {
            continue;
        }
        IoUTrack track{
            nextTrackId++,
            detectionClassIds[d],
            detectionBoxes[d],
            detectionConfidences[d],
            0
        };
        detectionTrackIds[d] = track.id;
        tracks.push_back(track);
    }
    // Preserve temporarily missed tracks long enough for reacquisition.
    tracks.erase(
        std::remove_if(tracks.begin(), tracks.end(),
            [](const IoUTrack& track) {
                return track.missedFrames > 600;
            }),
        tracks.end()
    );
    return detectionTrackIds;
}
string getCurrentTimestamp() {
    const auto now = chrono::system_clock::now();
    const time_t currentTime = chrono::system_clock::to_time_t(now);
    tm localTime{};
#ifdef _WIN32
    if (localtime_s(&localTime, &currentTime) != 0) {
        return "UNKNOWN_TIME";
    }
#else
    const tm* timeInfo = std::localtime(&currentTime);
    if (timeInfo == nullptr) {
        return "UNKNOWN_TIME";
    }
    localTime = *timeInfo;
#endif
    ostringstream timestamp;
    timestamp << put_time(&localTime, "%Y-%m-%d %H:%M:%S");
    return timestamp.str();
}
// Generate a unique identifier for this program run. Track IDs can restart
// at #1 on every run, so reports must group by session_id as well as track_id.
string getCurrentSessionId() {
    const auto now = chrono::system_clock::now();
    const time_t currentTime = chrono::system_clock::to_time_t(now);
    tm localTime{};
#ifdef _WIN32
    if (localtime_s(&localTime, &currentTime) != 0) {
        return "SESSION_UNKNOWN";
    }
#else
    const tm* timeInfo = std::localtime(&currentTime);
    if (timeInfo == nullptr) {
        return "SESSION_UNKNOWN";
    }
    localTime = *timeInfo;
#endif
    const auto micros = chrono::duration_cast<chrono::microseconds>(
        now.time_since_epoch()
    ).count() % 1000000;
    ostringstream session;
    session << "SESSION_" << put_time(&localTime, "%Y%m%d_%H%M%S")
            << "_" << setw(6) << setfill('0') << micros;
    return session.str();
}
// Map a detector box from the letterboxed 640x640 input to the source webcam frame.
Rect mapModelBoxToFrame(const Rect2d& box, const Mat& frame,
                        int left, int top,
                        int newWidth, int newHeight) {
    if (frame.empty() || newWidth <= 0 || newHeight <= 0) return Rect();
    int x1 = static_cast<int>(std::round((box.x - left) * frame.cols / newWidth));
    int y1 = static_cast<int>(std::round((box.y - top) * frame.rows / newHeight));
    int x2 = static_cast<int>(std::round((box.x + box.width - left) * frame.cols / newWidth));
    int y2 = static_cast<int>(std::round((box.y + box.height - top) * frame.rows / newHeight));
    x1 = std::clamp(x1, 0, frame.cols - 1);
    y1 = std::clamp(y1, 0, frame.rows - 1);
    x2 = std::clamp(x2, 0, frame.cols - 1);
    y2 = std::clamp(y2, 0, frame.rows - 1);
    if (x2 <= x1 || y2 <= y1) return Rect();
    return Rect(x1, y1, x2 - x1, y2 - y1);
}
// Match Ultralytics classification inference preprocessing at imgsz=224:
// resize the shortest edge to 224, center-crop to 224x224, convert BGR->RGB,
// and scale bytes to [0,1]. Ultralytics' default classify mean/std are 0/1.
Mat makeVerifierBlob(const Mat& bgrCrop, int side = 224) {
    if (bgrCrop.empty()) throw runtime_error("Empty crop passed to person verifier.");
    int resizedWidth = side;
    int resizedHeight = side;
    if (bgrCrop.cols < bgrCrop.rows) {
        resizedWidth = side;
        resizedHeight = std::max(side, static_cast<int>(side *
            static_cast<double>(bgrCrop.rows) / bgrCrop.cols));
    } else {
        resizedHeight = side;
        resizedWidth = std::max(side, static_cast<int>(side *
            static_cast<double>(bgrCrop.cols) / bgrCrop.rows));
    }
    Mat resized;
    resize(bgrCrop, resized, Size(resizedWidth, resizedHeight), 0, 0, INTER_LINEAR);
    const int cropX = std::max(0, (resized.cols - side) / 2);
    const int cropY = std::max(0, (resized.rows - side) / 2);
    Mat centered = resized(Rect(cropX, cropY, side, side));
    Mat blob;
    blobFromImage(centered, blob, 1.0 / 255.0, Size(side, side),
                  Scalar(), true, false, CV_32F);
    return blob;
}
// Exported YOLO26n-cls classifier classes were verified as:
// class 0 = helmet, class 1 = person. Return P(person).
float predictPersonProbability(Net& verifierNet, const Mat& bgrCrop) {
    Mat blob = makeVerifierBlob(bgrCrop, 224);
    verifierNet.setInput(blob);
    Mat output = verifierNet.forward();
    if (output.empty() || output.total() != 2 || output.type() != CV_32F) {
        throw runtime_error("Unexpected verifier output. Expected two FP32 class scores (helmet, person).");
    }
    Mat flat = output.reshape(1, 1);
    float helmetScore = flat.at<float>(0, 0);
    float personScore = flat.at<float>(0, 1);
    // Current Ultralytics ONNX export returns probabilities. If this export
    // returns logits instead, convert them to probabilities defensively.
    const float sum = helmetScore + personScore;
    const bool looksLikeProbabilities =
        std::isfinite(helmetScore) && std::isfinite(personScore) &&
        helmetScore >= 0.0f && helmetScore <= 1.0f &&
        personScore >= 0.0f && personScore <= 1.0f &&
        std::abs(sum - 1.0f) < 0.02f;
    if (looksLikeProbabilities) return personScore;
    const float maxScore = std::max(helmetScore, personScore);
    const double expHelmet = std::exp(static_cast<double>(helmetScore - maxScore));
    const double expPerson = std::exp(static_cast<double>(personScore - maxScore));
    const double denom = expHelmet + expPerson;
    if (!std::isfinite(denom) || denom <= 0.0) return 0.0f;
    return static_cast<float>(expPerson / denom);
}
// A non-blocking, latched audible alarm. A condition variable wakes the worker
// immediately when an intrusion is detected. Fast alternating tones keep
// sounding until M is pressed or the application exits.
class ContinuousAudibleAlarm {
public:
    ContinuousAudibleAlarm()
        : worker_([this]() { run(); }) {}
    ContinuousAudibleAlarm(const ContinuousAudibleAlarm&) = delete;
    ContinuousAudibleAlarm& operator=(const ContinuousAudibleAlarm&) = delete;
    ~ContinuousAudibleAlarm() {
        stop_.store(true);
        active_.store(false);
        wake_.notify_all();
        if (worker_.joinable()) worker_.join();
    }
    void start() {
        active_.store(true);
        wake_.notify_all();
    }
    void silence() {
        active_.store(false);
        wake_.notify_all();
    }
    bool isActive() const { return active_.load(); }
private:
    void run() {
        while (!stop_.load()) {
            std::unique_lock<std::mutex> lock(mutex_);
            wake_.wait(lock, [this]() {
                return stop_.load() || active_.load();
            });
            if (stop_.load()) break;
            lock.unlock();
            // Start tone immediately after start(); short tones make manual mute responsive.
            Beep(1350, 160);
            if (stop_.load()) break;
            if (active_.load()) Beep(850, 160);
            if (stop_.load()) break;
            lock.lock();
            wake_.wait_for(lock, std::chrono::milliseconds(45), [this]() {
                return stop_.load() || !active_.load();
            });
        }
    }
    std::atomic<bool> stop_{false};
    std::atomic<bool> active_{false};
    std::mutex mutex_;
    std::condition_variable wake_;
    std::thread worker_;
};

// -----------------------------------------------------------------------------
// IBVAP local bridge IPC. The HTTP bridge is a separate Python standard-library
// process; communication with this C++ loop uses files under ./runtime.
// This avoids adding HTTP/WebSocket library dependencies to the working build.
// -----------------------------------------------------------------------------
struct RuntimeDetection {
    int trackId = -1;
    int classId = -1;
    std::string label;
    float confidence = 0.0f;
    double x1 = 0.0, y1 = 0.0, x2 = 0.0, y2 = 0.0;
    bool isIntrusion = false;
    double overlapRatio = 0.0;
};

static void writeTextFileReplace(const std::string& path, const std::string& content) {
    const std::string tempPath = path + ".tmp";
    {
        std::ofstream out(tempPath, std::ios::binary | std::ios::trunc);
        if (!out) return;
        out << content;
        out.flush();
        if (!out) return;
    }
    std::error_code ec;
    std::filesystem::remove(path, ec);
    ec.clear();
    std::filesystem::rename(tempPath, path, ec);
    if (ec) {
        // Windows can temporarily lock a file while the bridge reads it. The
        // final direct-write fallback is intentionally small and local only.
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (out) out << content;
        std::filesystem::remove(tempPath, ec);
    }
}

static bool readRuntimeCameraEnabled(bool currentValue) {
    std::ifstream in("runtime/camera_enabled.txt");
    int value = currentValue ? 1 : 0;
    if (in >> value) return value != 0;
    return currentValue;
}

static void consumeRuntimeZoneRequest(const std::string& zoneConfigPath,
                                      RestrictedZoneEditor& zone) {
    const std::string requestPath = "runtime/zone_request.txt";
    if (!std::filesystem::exists(requestPath)) return;

    std::string requestId;
    double x1 = 0.0, y1 = 0.0, x2 = 0.0, y2 = 0.0;
    {
        std::ifstream request(requestPath);
        if (!(request >> requestId >> x1 >> y1 >> x2 >> y2)) {
            request.close();
            std::error_code ec;
            std::filesystem::remove(requestPath, ec);
            writeTextFileReplace("runtime/zone_response.txt", "UNKNOWN ERR INVALID_REQUEST\n");
            return;
        }
    }
    std::error_code removeError;
    std::filesystem::remove(requestPath, removeError);

    const bool valid = std::isfinite(x1) && std::isfinite(y1) &&
        std::isfinite(x2) && std::isfinite(y2) &&
        x1 >= 0.0 && y1 >= 0.0 && x2 <= 1.0 && y2 <= 1.0 &&
        x2 - x1 >= 0.02 && y2 - y1 >= 0.02;
    if (!valid) {
        writeTextFileReplace("runtime/zone_response.txt", requestId + " ERR INVALID_ZONE\n");
        return;
    }

    RestrictedZoneEditor proposed = zone;
    proposed.x1 = x1; proposed.y1 = y1; proposed.x2 = x2; proposed.y2 = y2;
    proposed.originalX1 = x1; proposed.originalY1 = y1;
    proposed.originalX2 = x2; proposed.originalY2 = y2;
    proposed.editing = false; proposed.dragging = false; proposed.hasDraft = false;

    if (!saveRestrictedZone(zoneConfigPath, proposed)) {
        writeTextFileReplace("runtime/zone_response.txt", requestId + " ERR SAVE_FAILED\n");
        return;
    }
    zone = proposed;
    std::ostringstream response;
    response << requestId << " OK " << std::fixed << std::setprecision(6)
             << x1 << ' ' << y1 << ' ' << x2 << ' ' << y2 << '\n';
    writeTextFileReplace("runtime/zone_response.txt", response.str());
    std::cout << "[API] Restricted zone updated by frontend and saved to "
              << zoneConfigPath << std::endl;
}

static std::string runtimeAlarmState(bool alarmActive, bool silencedByOperator) {
    if (alarmActive) return "TRIGGERED";
    if (silencedByOperator) return "SILENCED";
    return "NORMAL";
}

static void publishRuntimeSnapshot(const cv::Mat& rawFrame,
                                   const std::vector<RuntimeDetection>& detections,
                                   double fps, double yoloMs, double verifierMs,
                                   bool cameraEnabled, bool alarmActive,
                                   bool silencedByOperator, int activeTrackId,
                                   const RestrictedZoneEditor& zone) {
    try {
        std::filesystem::create_directories("runtime");
        static auto lastFrameWrite = std::chrono::steady_clock::time_point{};
        const auto now = std::chrono::steady_clock::now();
        if (!rawFrame.empty() &&
            (lastFrameWrite.time_since_epoch().count() == 0 ||
             now - lastFrameWrite >= std::chrono::milliseconds(100))) {
            std::vector<unsigned char> jpeg;
            const std::vector<int> params = {cv::IMWRITE_JPEG_QUALITY, 78};
            if (cv::imencode(".jpg", rawFrame, jpeg, params)) {
                const std::string tmp = "runtime/frame.jpg.tmp";
                {
                    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
                    if (out) out.write(reinterpret_cast<const char*>(jpeg.data()),
                                       static_cast<std::streamsize>(jpeg.size()));
                }
                std::error_code ec;
                std::filesystem::remove("runtime/frame.jpg", ec);
                ec.clear();
                std::filesystem::rename(tmp, "runtime/frame.jpg", ec);
                if (ec) std::filesystem::remove(tmp, ec);
            }
            lastFrameWrite = now;
        }

        static auto lastStateWrite = std::chrono::steady_clock::time_point{};
        if (lastStateWrite.time_since_epoch().count() != 0 &&
            now - lastStateWrite < std::chrono::milliseconds(70)) return;
        lastStateWrite = now;

        std::ostringstream json;
        json << std::fixed << std::setprecision(6);
        json << "{\"timestamp\":\"" << getCurrentTimestamp()
             << "\",\"cameraId\":\"CAM-01 (Local webcam)\",\"cameraState\":\""
             << (cameraEnabled ? "ON" : "OFF") << "\",\"fps\":" << (cameraEnabled ? fps : 0.0)
             << ",\"yoloMs\":" << yoloMs << ",\"verifierMs\":" << verifierMs
             << ",\"zone\":{\"x1\":" << zone.x1 << ",\"y1\":" << zone.y1
             << ",\"x2\":" << zone.x2 << ",\"y2\":" << zone.y2 << "}"
             << ",\"alarm\":{\"state\":\"" << runtimeAlarmState(alarmActive, silencedByOperator)
             << "\",\"activeTrackId\":";
        if (activeTrackId >= 0) json << activeTrackId; else json << "null";
        json << "},\"detections\":[";
        bool first = true;
        for (const auto& d : detections) {
            if (!first) json << ',';
            first = false;
            json << "{\"id\":" << d.trackId << ",\"trackId\":" << d.trackId
                 << ",\"label\":\"" << d.label << "\",\"classId\":" << d.classId
                 << ",\"confidence\":" << d.confidence
                 << ",\"x1\":" << d.x1 << ",\"y1\":" << d.y1
                 << ",\"x2\":" << d.x2 << ",\"y2\":" << d.y2
                 << ",\"isIntrusion\":" << (d.isIntrusion ? "true" : "false")
                 << ",\"overlapRatio\":" << d.overlapRatio << '}';
        }
        json << "]}\n";
        writeTextFileReplace("runtime/state.json", json.str());
    } catch (const std::exception& e) {
        std::cerr << "[API IPC] Could not publish runtime snapshot: " << e.what() << std::endl;
    }
}

int main() {
    try {
        const string modelPath = "models/yolo26s.onnx";
        const string verifierModelPath = "models/helmet_verifier_v3.onnx";
        const float verifierPersonThreshold = 0.70f;
        // Use the laptop's default webcam (usually camera index 0).
        const int cameraIndex = 0;
        const int inputSize = 640;
        const float confidenceThreshold = 0.40f;
        cout << "Loading YOLO26s model..." << endl;
        Net net = readNetFromONNX(modelPath);
        if (net.empty()) {
            cerr << "Error: Could not load YOLO26s ONNX model: " << modelPath << endl;
            return 1;
        }
        cout << "Loading person/helmet verifier..." << endl;
        Net verifierNet = readNetFromONNX(verifierModelPath);
        if (verifierNet.empty()) {
            cerr << "Error: Could not load verifier ONNX model: "
                 << verifierModelPath << endl;
            return 1;
        }
        // CPU provider keeps this second-stage path broadly compatible with OpenCV DNN.
        verifierNet.setPreferableBackend(DNN_BACKEND_OPENCV);
        verifierNet.setPreferableTarget(DNN_TARGET_CPU);
        VideoCapture video(cameraIndex, CAP_ANY);
        if (!video.isOpened()) {
            cerr << "Error: Could not open webcam index " << cameraIndex << "." << endl;
            cerr << "Check Windows camera permissions and close other apps using the camera." << endl;
            return 1;
        }
        // Request a practical live-processing resolution. The camera may choose
        // a nearby supported resolution, so the processing loop uses actual frame size.
        video.set(CAP_PROP_FRAME_WIDTH, 1280);
        video.set(CAP_PROP_FRAME_HEIGHT, 720);
        cout << "Webcam opened: "
             << static_cast<int>(video.get(CAP_PROP_FRAME_WIDTH)) << " x "
             << static_cast<int>(video.get(CAP_PROP_FRAME_HEIGHT)) << endl;
        // Create the log folder if it does not exist.
        filesystem::create_directories("logs");
        const string logPath = "logs/intrusion_events.csv";
        bool logIsEmpty = false;
        {
            ifstream existingLog(logPath, ios::binary);
            logIsEmpty = !existingLog ||
                         existingLog.peek() == ifstream::traits_type::eof();
        }
        ofstream eventLog(logPath, ios::app);
        if (!eventLog.is_open()) {
            cerr << "Error: Could not open intrusion log: " << logPath << endl;
            return 1;
        }
        if (logIsEmpty) {
            eventLog << "timestamp,event,object,confidence\n";
            eventLog.flush();
        }
        // Keep the original CSV intact; write track IDs to a separate file.
        const string trackedLogPath = "logs/intrusion_events_tracked.csv";
        bool trackedLogIsEmpty = false;
        {
            ifstream existingTrackedLog(trackedLogPath, ios::binary);
            trackedLogIsEmpty =
                !existingTrackedLog ||
                existingTrackedLog.peek() == ifstream::traits_type::eof();
        }
        ofstream trackedEventLog(trackedLogPath, ios::app);
        if (!trackedEventLog.is_open()) {
            cerr << "Error: Could not open tracked intrusion log: "
                 << trackedLogPath << endl;
            return 1;
        }
        if (trackedLogIsEmpty) {
            trackedEventLog
                << "timestamp,event,object,track_id,confidence\n";
            trackedEventLog.flush();
        }
        // Session-aware log avoids conflating track #1 from different program runs.
        const string sessionLogPath = "logs/intrusion_events_sessions.csv";
        bool sessionLogIsEmpty = false;
        {
            ifstream existingSessionLog(sessionLogPath, ios::binary);
            sessionLogIsEmpty = !existingSessionLog ||
                existingSessionLog.peek() == ifstream::traits_type::eof();
        }
        ofstream sessionEventLog(sessionLogPath, ios::app);
        if (!sessionEventLog.is_open()) {
            cerr << "Error: Could not open session-aware event log: "
                 << sessionLogPath << endl;
            return 1;
        }
        if (sessionLogIsEmpty) {
            sessionEventLog
                << "session_id,timestamp,event,object,track_id,confidence\n";
            sessionEventLog.flush();
            // Preserve historical records once, under a LEGACY session label.
            ifstream legacyInput(trackedLogPath);
            string legacyLine;
            int migratedRows = 0;
            while (getline(legacyInput, legacyLine)) {
                if (!legacyLine.empty() && legacyLine.back() == '\r') {
                    legacyLine.pop_back();
                }
                if (legacyLine.empty() ||
                    legacyLine.rfind("timestamp,event,object,track_id,confidence", 0) == 0) {
                    continue;
                }
                const size_t commas = static_cast<size_t>(
                    count(legacyLine.begin(), legacyLine.end(), ',')
                );
                if (commas < 4) continue;
                sessionEventLog << "LEGACY," << legacyLine << '\n';
                ++migratedRows;
            }
            sessionEventLog.flush();
            if (migratedRows > 0) {
                cout << "Migrated historical tracked events: "
                     << migratedRows << " (session LEGACY)." << endl;
            }
        }
        const string sessionId = getCurrentSessionId();
        // Save one evidence image for each newly logged intrusion.
        const string evidenceDirectory = "logs/evidence";
        filesystem::create_directories(evidenceDirectory);
        // YOLO26 ONNX expects RGB channels normalized to [0, 1].
        // Each frame is letterboxed to 640 x 640 before inference.
        Mat frame;
        // Persistent object-tracking state.
        vector<IoUTrack> tracks;
        int nextTrackId = 1;
        // Each tracked person has an independent intrusion episode.
        unordered_map<int, IntrusionTrackState> intrusionTrackStates;
        const chrono::milliseconds intrusionClearGrace(15000);
        ContinuousAudibleAlarm audibleAlarm;
        bool alarmSilencedByOperator = false;
        cout << "YOLO26s real-time webcam detection and restricted-zone monitoring started." << endl;
        cout << "Log file: " << logPath << endl;
        cout << "Track-aware log: " << trackedLogPath << endl;
        cout << "Session-aware log: " << sessionLogPath << endl;
        cout << "Session ID: " << sessionId << endl;
        cout << "YOLO26 confidence threshold: " << confidenceThreshold << endl;
        cout << "Verifier model: " << verifierModelPath << endl;
        cout << "Verifier class order: 0=helmet, 1=person" << endl;
        cout << "Verifier person threshold: " << verifierPersonThreshold << endl;
        cout << "Verifier preprocessing: 224x224 RGB, resize-short-edge + center crop, [0,1]" << endl;
        cout << "Audible alarm: immediate on verified bounding-box/zone overlap; repeats until M." << endl;
        cout << "Press M to silence the current alarm; Esc exits and stops alarm." << endl;
        // Smoothed performance telemetry for the live preview and console.
        double smoothedFps = 0.0;
        double smoothedInferenceMs = 0.0;
        double smoothedVerifierMs = 0.0;
        auto lastPerformanceLogTime = chrono::steady_clock::now();
        const string zoneConfigPath = "config/restricted_zone.txt";
        if (loadRestrictedZone(zoneConfigPath, gZoneEditor)) {
            cout << "Loaded saved restricted zone from " << zoneConfigPath << endl;
        } else {
            cout << "Using default restricted zone; press T to edit, drag with left mouse, then S to save." << endl;
        }
        // Initialize local-bridge runtime files. The Python bridge is loopback-only.
        filesystem::create_directories("runtime");
        // Start each new C++ process in the enabled state; the frontend can pause it later.
        {
            ofstream cameraStateFile("runtime/camera_enabled.txt", ios::trunc);
            cameraStateFile << "1\n";
        }
        bool cameraEnabled = true;

        namedWindow("IBVAP - AI Intrusion Detection", WINDOW_NORMAL);
        resizeWindow("IBVAP - AI Intrusion Detection", PREVIEW_WIDTH, PREVIEW_HEIGHT);
        setMouseCallback("IBVAP - AI Intrusion Detection", restrictedZoneMouseCallback, nullptr);
        while (true) {

            consumeRuntimeZoneRequest(zoneConfigPath, gZoneEditor);
            if (filesystem::exists("runtime/silence_alarm.flag")) {
                audibleAlarm.silence();
                alarmSilencedByOperator = true;
                error_code silenceEc;
                filesystem::remove("runtime/silence_alarm.flag", silenceEc);
                cout << "[ALARM] Silenced by frontend operator command." << endl;
            }
            cameraEnabled = readRuntimeCameraEnabled(cameraEnabled);

            const auto frameStartTime = chrono::steady_clock::now();
            if (!video.read(frame) || frame.empty()) {
                cerr << "Warning: webcam frame unavailable; retrying..." << endl;
                const int recoveryKey = waitKey(1) & 0xFF;
                if (recoveryKey == 27) {
                    break;
                }
                if ((recoveryKey == 'm' || recoveryKey == 'M') && audibleAlarm.isActive()) {
                    audibleAlarm.silence();
                    alarmSilencedByOperator = true;
                    cout << "[ALARM] Silenced manually. A newly registered intrusion will sound the alarm again." << endl;
                }
                continue;
            }
            if (!cameraEnabled) {
                Mat pausedResult = frame.clone();
                const vector<Point> pausedZone = {
                    Point(static_cast<int>(gZoneEditor.x1 * frame.cols), static_cast<int>(gZoneEditor.y1 * frame.rows)),
                    Point(static_cast<int>(gZoneEditor.x2 * frame.cols), static_cast<int>(gZoneEditor.y1 * frame.rows)),
                    Point(static_cast<int>(gZoneEditor.x2 * frame.cols), static_cast<int>(gZoneEditor.y2 * frame.rows)),
                    Point(static_cast<int>(gZoneEditor.x1 * frame.cols), static_cast<int>(gZoneEditor.y2 * frame.rows))
                };
                const vector<vector<Point>> pausedPolygons = { pausedZone };
                Mat pausedOverlay = pausedResult.clone();
                fillPoly(pausedOverlay, pausedPolygons, Scalar(0, 0, 255));
                addWeighted(pausedOverlay, 0.16, pausedResult, 0.84, 0, pausedResult);
                polylines(pausedResult, pausedPolygons, true, Scalar(0, 0, 255), 3);
                putText(pausedResult, "MONITORING PAUSED BY OPERATOR", Point(20, 45),
                        FONT_HERSHEY_SIMPLEX, 0.9, Scalar(0, 215, 255), 2);
                putText(pausedResult, "Frontend camera toggle is OFF; press T/S to edit/save zone, M to silence, Esc to exit",
                        Point(20, frame.rows - 20), FONT_HERSHEY_SIMPLEX, 0.48, Scalar(255, 255, 255), 1);
                publishRuntimeSnapshot(frame, {}, 0.0, smoothedInferenceMs, smoothedVerifierMs,
                                       false, audibleAlarm.isActive(), alarmSilencedByOperator,
                                       -1, gZoneEditor);
                Mat pausedDisplay;
                resize(pausedResult, pausedDisplay, Size(1280, 800));
                imshow("IBVAP - AI Intrusion Detection", pausedDisplay);
                const int pausedKey = waitKey(1) & 0xFF;
                if (pausedKey == 27) break;
                if ((pausedKey == 'm' || pausedKey == 'M') && audibleAlarm.isActive()) {
                    audibleAlarm.silence();
                    alarmSilencedByOperator = true;
                } else if (pausedKey == 't' || pausedKey == 'T') {
                    if (!gZoneEditor.editing) {
                        gZoneEditor.editing = true;
                        gZoneEditor.originalX1 = gZoneEditor.x1; gZoneEditor.originalY1 = gZoneEditor.y1;
                        gZoneEditor.originalX2 = gZoneEditor.x2; gZoneEditor.originalY2 = gZoneEditor.y2;
                        gZoneEditor.dragging = false; gZoneEditor.hasDraft = false;
                    } else {
                        gZoneEditor.x1 = gZoneEditor.originalX1; gZoneEditor.y1 = gZoneEditor.originalY1;
                        gZoneEditor.x2 = gZoneEditor.originalX2; gZoneEditor.y2 = gZoneEditor.originalY2;
                        gZoneEditor.editing = false; gZoneEditor.dragging = false; gZoneEditor.hasDraft = false;
                    }
                } else if (pausedKey == 's' || pausedKey == 'S') {
                    if (gZoneEditor.editing && gZoneEditor.hasDraft &&
                        gZoneEditor.x2 - gZoneEditor.x1 >= 0.02 && gZoneEditor.y2 - gZoneEditor.y1 >= 0.02 &&
                        saveRestrictedZone(zoneConfigPath, gZoneEditor)) {
                        gZoneEditor.editing = false; gZoneEditor.dragging = false; gZoneEditor.hasDraft = false;
                    }
                }
                continue;
            }

            // Letterbox while preserving aspect ratio, then pad to 640 x 640.
            const double scale = min(
                inputSize / static_cast<double>(frame.cols),
                inputSize / static_cast<double>(frame.rows)
            );
            const int newWidth = max(1, static_cast<int>(frame.cols * scale));
            const int newHeight = max(1, static_cast<int>(frame.rows * scale));
            Mat resized;
            resize(frame, resized, Size(newWidth, newHeight), 0, 0, INTER_AREA);
            const int left = (inputSize - newWidth) / 2;
            const int right = inputSize - newWidth - left;
            const int top = (inputSize - newHeight) / 2;
            const int bottom = inputSize - newHeight - top;
            Mat padded;
            copyMakeBorder(
                resized, padded, top, bottom, left, right,
                BORDER_CONSTANT, Scalar(114, 114, 114)
            );
            Mat blob;
            // YOLO26 ONNX input is RGB normalized from 0 to 1.
            blobFromImage(
                padded, blob, 1.0 / 255.0,
                Size(inputSize, inputSize), Scalar(), true, false, CV_32F
            );
            const auto inferenceStartTime = chrono::steady_clock::now();
            net.setInput(blob);
            vector<Mat> outputs;
            net.forward(outputs, net.getUnconnectedOutLayersNames());
            const auto inferenceEndTime = chrono::steady_clock::now();
            const double inferenceMs = chrono::duration<double, milli>(
                inferenceEndTime - inferenceStartTime
            ).count();
            if (smoothedInferenceMs <= 0.0) {
                smoothedInferenceMs = inferenceMs;
            } else {
                smoothedInferenceMs = 0.90 * smoothedInferenceMs + 0.10 * inferenceMs;
            }
            // Exported YOLO26 one-to-one head (nms=False) returns
            // [1, 300, 6]: x1, y1, x2, y2, confidence, class_id.
            if (outputs.size() != 1 || outputs[0].dims != 3 ||
                outputs[0].size[0] != 1 || outputs[0].size[2] < 6) {
                cerr << "Unexpected YOLO26 output shape. Expected [1, 300, 6]." << endl;
                if (!outputs.empty()) {
                    cerr << "Received dims=" << outputs[0].dims;
                    for (int d = 0; d < outputs[0].dims; ++d) {
                        cerr << (d == 0 ? " shape=[" : ", ") << outputs[0].size[d];
                    }
                    cerr << "]" << endl;
                }
                cerr << "Make sure models/yolo26s.onnx is exported with nms=False." << endl;
                break;
            }
            const Mat& rawOutput = outputs[0];
            if (rawOutput.type() != CV_32F) {
                cerr << "YOLO26 output must be FP32; received type "
                     << rawOutput.type() << endl;
                break;
            }
            const int predictionCount = rawOutput.size[1];
            const int predictionWidth = rawOutput.size[2];
            Mat predictions(predictionCount, predictionWidth, CV_32F,
                            const_cast<float*>(rawOutput.ptr<float>()));
            vector<Rect2d> boxes;
            vector<float> confidences;
            vector<int> classIds;
            for (int i = 0; i < predictionCount; ++i) {
                const float* row = predictions.ptr<float>(i);
                const float confidence = row[4];
                const int classId = static_cast<int>(std::lround(row[5]));
                if (!std::isfinite(confidence) ||
                    confidence < confidenceThreshold ||
                    targetClassName(classId).empty()) {
                    continue;
                }
                // Model outputs are xyxy pixel coordinates in the 640x640
                // letterboxed model input. Downstream code maps them back to
                // the original camera frame using left/top/newWidth/newHeight.
                const double x1 = std::clamp(static_cast<double>(row[0]), 0.0,
                                             static_cast<double>(inputSize - 1));
                const double y1 = std::clamp(static_cast<double>(row[1]), 0.0,
                                             static_cast<double>(inputSize - 1));
                const double x2 = std::clamp(static_cast<double>(row[2]), 0.0,
                                             static_cast<double>(inputSize - 1));
                const double y2 = std::clamp(static_cast<double>(row[3]), 0.0,
                                             static_cast<double>(inputSize - 1));
                if (x2 <= x1 || y2 <= y1) {
                    continue;
                }
                boxes.emplace_back(x1, y1, x2 - x1, y2 - y1);
                confidences.push_back(confidence);
                classIds.push_back(classId);
            }
            // YOLO26's exported one-to-one head already returns end-to-end
            // detections, so do not run an additional NMS pass here.
            vector<int> kept;
            kept.reserve(boxes.size());
            for (int i = 0; i < static_cast<int>(boxes.size()); ++i) {
                kept.push_back(i);
            }
            // Second-stage verifier: every YOLO person candidate must also look
            // like a person to the classifier. Vehicle detections pass unchanged.
            vector<int> verifiedKept;
            verifiedKept.reserve(kept.size());
            vector<float> verifierPersonScores(boxes.size(), -1.0f);
            int verifierRejectedThisFrame = 0;
            double verifierMsThisFrame = 0.0;
            for (int index : kept) {
                if (classIds[index] != 0) {
                    verifiedKept.push_back(index);
                    continue;
                }
                const Rect cropRect = mapModelBoxToFrame(
                    boxes[index], frame, left, top, newWidth, newHeight
                );
                if (cropRect.empty()) continue;
                const auto verifierStart = chrono::steady_clock::now();
                const float pPerson = predictPersonProbability(
                    verifierNet, frame(cropRect)
                );
                const auto verifierEnd = chrono::steady_clock::now();
                verifierMsThisFrame += chrono::duration<double, milli>(
                    verifierEnd - verifierStart
                ).count();
                verifierPersonScores[index] = pPerson;
                if (pPerson >= verifierPersonThreshold) {
                    verifiedKept.push_back(index);
                } else {
                    ++verifierRejectedThisFrame;
                }
            }
            if (smoothedVerifierMs <= 0.0) {
                smoothedVerifierMs = verifierMsThisFrame;
            } else {
                smoothedVerifierMs = 0.90 * smoothedVerifierMs +
                                     0.10 * verifierMsThisFrame;
            }
            // Prepare verifier-approved frame-coordinate detections for tracking.
            vector<Rect> trackedDetectionBoxes;
            vector<int> trackedDetectionClasses;
            vector<float> trackedDetectionConfidences;
            vector<int> trackedBoxIndices;
            // Maps each original detection index to its persistent ID.
            vector<int> trackIdsByBoxIndex(boxes.size(), -1);
            for (int index : verifiedKept) {
                const Rect mapped = mapModelBoxToFrame(
                    boxes[index], frame, left, top, newWidth, newHeight
                );
                if (mapped.empty()) continue;
                trackedDetectionBoxes.push_back(mapped);
                trackedDetectionClasses.push_back(classIds[index]);
                trackedDetectionConfidences.push_back(confidences[index]);
                trackedBoxIndices.push_back(index);
            }
            // Match current detections to existing tracks.
            vector<int> detectionTrackIds = updateIoUTracks(
                tracks,
                trackedDetectionBoxes,
                trackedDetectionClasses,
                trackedDetectionConfidences,
                nextTrackId
            );
            // Preserve the IDs against the original detection indices.
            for (size_t i = 0; i < detectionTrackIds.size(); ++i) {
                trackIdsByBoxIndex[trackedBoxIndices[i]] =
                    detectionTrackIds[i];
            }
            Mat result = frame.clone();
            // Draw the current editable restricted zone. It remains the same zone
            // used by overlap checking and alarm logic below.
            const double zx1 = gZoneEditor.x1, zy1 = gZoneEditor.y1;
            const double zx2 = gZoneEditor.x2, zy2 = gZoneEditor.y2;
            vector<Point> zone = {
                Point(static_cast<int>(zx1 * frame.cols), static_cast<int>(zy1 * frame.rows)),
                Point(static_cast<int>(zx2 * frame.cols), static_cast<int>(zy1 * frame.rows)),
                Point(static_cast<int>(zx2 * frame.cols), static_cast<int>(zy2 * frame.rows)),
                Point(static_cast<int>(zx1 * frame.cols), static_cast<int>(zy2 * frame.rows))
            };
            const vector<vector<Point>> zonePolygons = {zone};
            Mat overlay = result.clone();
            fillPoly(overlay, zonePolygons, Scalar(0, 0, 255));
            addWeighted(overlay, 0.16, result, 0.84, 0, result);
            polylines(result, zonePolygons, true, Scalar(0, 0, 255), 3);
            putText(result, "RESTRICTED ZONE",
                    Point(max(10, zone[0].x + 8), max(25, zone[0].y + 28)),
                    FONT_HERSHEY_SIMPLEX, 0.8, Scalar(255, 255, 255), 2);
            if (gZoneEditor.editing) {
                if (gZoneEditor.dragging) {
                    Point a(static_cast<int>(gZoneEditor.startX * frame.cols),
                            static_cast<int>(gZoneEditor.startY * frame.rows));
                    Point b(static_cast<int>(gZoneEditor.endX * frame.cols),
                            static_cast<int>(gZoneEditor.endY * frame.rows));
                    rectangle(result, a, b, Scalar(0, 255, 255), 2);
                }
                putText(result, "ZONE EDIT: drag left mouse; S save/apply; T cancel",
                        Point(20, frame.rows - 20), FONT_HERSHEY_SIMPLEX,
                        0.65, Scalar(0, 255, 255), 2);
            } else {
                putText(result, "Press T to edit restricted zone | M silence alarm | Esc exit",
                        Point(20, frame.rows - 20), FONT_HERSHEY_SIMPLEX,
                        0.58, Scalar(255, 255, 255), 2);
            }
            int personCount = 0;
            int vehicleCount = 0;
            vector<RuntimeDetection> runtimeDetections;
            bool intrusionDetected = false;
            // Highest confidence for each person currently inside the zone.
            unordered_map<int, float> intrudingTrackConfidences;
            unordered_map<int, Point2d> intrudingTrackFeet;
            for (int index : verifiedKept) {
                const Rect mapped = mapModelBoxToFrame(
                    boxes[index], frame, left, top, newWidth, newHeight
                );
                if (mapped.empty()) continue;
                const int x1 = mapped.x;
                const int y1 = mapped.y;
                const int x2 = mapped.x + mapped.width;
                const int y2 = mapped.y + mapped.height;
                const int classId = classIds[index];
                const string classLabel = targetClassName(classId);
                if (classId == 0) {
                    ++personCount;
                } else {
                    ++vehicleCount;
                }
                // Trigger as soon as a verified person's bounding box overlaps
                // at least 3% of the restricted zone. This is earlier than waiting
                // for the bottom-centre/feet point to cross the zone boundary.
                const Point foot((x1 + x2) / 2, y2);
                const double zoneOverlapRatio = boundingBoxOverlapRatio(mapped, zone);
                const bool intruding = classId == 0 && zoneOverlapRatio >= 0.03;
                if (intruding) {
                    intrusionDetected = true;
                    const int detectedTrackId = trackIdsByBoxIndex[index];
                    if (detectedTrackId >= 0) {
                        auto inserted = intrudingTrackConfidences.emplace(
                            detectedTrackId, confidences[index]
                        );
                        if (!inserted.second) {
                            inserted.first->second = std::max(
                                inserted.first->second, confidences[index]
                            );
                        }
                        intrudingTrackFeet[detectedTrackId] =
                            Point2d(static_cast<double>(foot.x), static_cast<double>(foot.y));
                    }
                }
                RuntimeDetection runtimeDetection;
                runtimeDetection.trackId = trackIdsByBoxIndex[index];
                runtimeDetection.classId = classId;
                runtimeDetection.label = classLabel;
                runtimeDetection.confidence = confidences[index];
                runtimeDetection.x1 = static_cast<double>(x1) / frame.cols;
                runtimeDetection.y1 = static_cast<double>(y1) / frame.rows;
                runtimeDetection.x2 = static_cast<double>(x2) / frame.cols;
                runtimeDetection.y2 = static_cast<double>(y2) / frame.rows;
                runtimeDetection.isIntrusion = intruding;
                runtimeDetection.overlapRatio = zoneOverlapRatio;
                runtimeDetections.push_back(runtimeDetection);

                const Scalar boxColor = intruding ? Scalar(0, 0, 255) : Scalar(0, 255, 0);
                ostringstream textLabel;
                const int trackId = trackIdsByBoxIndex[index];
                if (intruding) {
                    textLabel << "INTRUSION: Person #" << trackId << " ";
                } else {
                    textLabel << classLabel << " #" << trackId << " ";
                }
                textLabel << fixed << setprecision(2) << confidences[index];
                if (classId == 0 && verifierPersonScores[index] >= 0.0f) {
                    textLabel << " V=" << setprecision(2) << verifierPersonScores[index];
                }
                rectangle(result, Point(x1, y1), Point(x2, y2), boxColor, 2);
                putText(
                    result, textLabel.str(), Point(x1, max(22, y1 - 8)),
                    FONT_HERSHEY_SIMPLEX, 0.7, boxColor, 2
                );
            }
            // Track each intrusion episode independently, while bridging short
            // tracker-ID switches when a single nearby person is reacquired.
            const auto steadyNow = chrono::steady_clock::now();
            vector<pair<int, float>> newIntrusions;
            for (const auto& entry : intrudingTrackConfidences) {
                const int trackId = entry.first;
                const Point2d currentFoot = intrudingTrackFeet[trackId];
                IntrusionTrackState& state = intrusionTrackStates[trackId];
                if (!state.active) {
                    int continuationTrackId = -1;
                    double bestFootDistance = std::numeric_limits<double>::max();
                    // If this new tracker ID appears where a recently active
                    // intruder was last seen, treat it as a continuation rather
                    // than immediately logging a duplicate event. Don't merge it
                    // with an old track that is also detected in this frame.
                    for (const auto& previousEntry : intrusionTrackStates) {
                        const int previousId = previousEntry.first;
                        const IntrusionTrackState& previousState = previousEntry.second;
                        if (previousId == trackId || !previousState.active) {
                            continue;
                        }
                        if (intrudingTrackConfidences.find(previousId) !=
                            intrudingTrackConfidences.end()) {
                            continue;
                        }
                        if (steadyNow - previousState.lastSeen >= intrusionClearGrace) {
                            continue;
                        }
                        const double dx = currentFoot.x - previousState.lastFoot.x;
                        const double dy = currentFoot.y - previousState.lastFoot.y;
                        const double footDistance = std::hypot(dx, dy);
                        if (footDistance <= 260.0 && footDistance < bestFootDistance) {
                            bestFootDistance = footDistance;
                            continuationTrackId = previousId;
                        }
                    }
                    state.active = true;
                    if (continuationTrackId >= 0) {
                        // Alias the new ID into the same ongoing intrusion episode.
                        cout << "[TRACK] Person #" << trackId
                             << " appears to continue the recent intrusion episode of Person #"
                             << continuationTrackId << ". Suppressing duplicate event."
                             << endl;
                        IntrusionTrackState& previousState =
                            intrusionTrackStates[continuationTrackId];
                        previousState.lastSeen = steadyNow;
                        previousState.lastFoot = currentFoot;
                    } else {
                        newIntrusions.emplace_back(trackId, entry.second);
                    }
                }
                state.lastSeen = steadyNow;
                state.lastFoot = currentFoot;
            }
            for (auto& entry : intrusionTrackStates) {
                const int trackId = entry.first;
                IntrusionTrackState& state = entry.second;
                if (state.active &&
                    intrudingTrackConfidences.find(trackId) == intrudingTrackConfidences.end() &&
                    steadyNow - state.lastSeen >= intrusionClearGrace) {
                    state.active = false;
                }
            }
            // A newly registered intrusion episode re-arms a manually silenced
            // alarm. The current-frame intrusion condition itself starts sound
            // immediately; it does not wait for track bookkeeping or log writes.
            if (!newIntrusions.empty()) {
                alarmSilencedByOperator = false;
            }
            if (intrusionDetected && !alarmSilencedByOperator && !audibleAlarm.isActive()) {
                audibleAlarm.start();
                cout << "[ALARM] IMMEDIATE ACTIVATION: verified person bounding box entered the restricted zone. Press M to silence." << endl;
            }
            if (intrusionDetected) {
                putText(
                    result, "WARNING: RESTRICTED ZONE INTRUSION!",
                    Point(20, 135), FONT_HERSHEY_SIMPLEX,
                    0.9, Scalar(0, 0, 255), 3
                );
            }
            if (audibleAlarm.isActive()) {
                putText(result, "AUDIBLE ALARM: SOUNDING - press M to silence",
                        Point(20, 170), FONT_HERSHEY_SIMPLEX, 0.72,
                        Scalar(0, 0, 255), 2);
            } else if (alarmSilencedByOperator) {
                putText(result, "ALARM SILENCED MANUALLY - will re-arm on next intrusion",
                        Point(20, 170), FONT_HERSHEY_SIMPLEX, 0.62,
                        Scalar(0, 215, 255), 2);
            }
            const string status =
                "People: " + to_string(personCount) +
                " | Vehicles: " + to_string(vehicleCount);
            putText(
                result, status, Point(20, 35),
                FONT_HERSHEY_SIMPLEX, 0.9, Scalar(0, 255, 255), 2
            );
            // Log each newly intruding track independently. Include the track ID
            // in the evidence filename so simultaneous events cannot overwrite images.
            for (const auto& intrusion : newIntrusions) {
                const int trackId = intrusion.first;
                const float confidence = intrusion.second;
                const string timestamp = getCurrentTimestamp();
                string fileTimestamp = timestamp;
                replace(fileTimestamp.begin(), fileTimestamp.end(), ':', '-');
                replace(fileTimestamp.begin(), fileTimestamp.end(), ' ', '_');
                const string evidencePath = evidenceDirectory +
                    "/intrusion_" + fileTimestamp + "_track_" +
                    to_string(trackId) + ".jpg";
                bool imageSaved = false;
                try {
                    imageSaved = imwrite(evidencePath, result);
                } catch (const cv::Exception& e) {
                    cerr << "Could not save evidence image: "
                         << e.what() << endl;
                }
                // Keep the original CSV's column format unchanged.
                eventLog << timestamp
                         << ",RESTRICTED_ZONE_INTRUSION,Person,"
                         << fixed << setprecision(2) << confidence << '\n';
                eventLog.flush();
                // Track-aware event record identifies which person triggered it.
                trackedEventLog << timestamp
                                << ",RESTRICTED_ZONE_INTRUSION,Person,"
                                << trackId << ","
                                << fixed << setprecision(2) << confidence << '\n';
                trackedEventLog.flush();
                sessionEventLog << sessionId << "," << timestamp
                                << ",RESTRICTED_ZONE_INTRUSION,Person,"
                                << trackId << ","
                                << fixed << setprecision(2) << confidence << '\n';
                sessionEventLog.flush();
                cout << "[ALERT] " << timestamp
                     << " | Session " << sessionId
                     << " | Restricted-zone intrusion | Person #"
                     << trackId << " | Confidence: "
                     << fixed << setprecision(2) << confidence << endl;
                if (imageSaved) {
                    cout << "Evidence image: " << evidencePath << endl;
                } else {
                    cerr << "Warning: intrusion event logged, but its evidence image was not saved."
                         << endl;
                }
            }
            // Measure full per-frame processing throughput (camera read through
            // detection, tracking and drawing). Inference time above isolates
            // net.setInput + net.forward and is smoothed to reduce jitter.
            const auto frameWorkEndTime = chrono::steady_clock::now();
            const double frameWorkMs = chrono::duration<double, milli>(
                frameWorkEndTime - frameStartTime
            ).count();
            const double instantFps = frameWorkMs > 0.0 ? 1000.0 / frameWorkMs : 0.0;
            if (smoothedFps <= 0.0) {
                smoothedFps = instantFps;
            } else {
                smoothedFps = 0.90 * smoothedFps + 0.10 * instantFps;
            }
            ostringstream performanceLine;
            performanceLine << fixed << setprecision(1)
                            << "FPS: " << smoothedFps
                            << " | YOLO: " << smoothedInferenceMs << " ms"
                            << " | Verifier: " << smoothedVerifierMs << " ms";
            putText(result, performanceLine.str(), Point(20, 65),
                    FONT_HERSHEY_SIMPLEX, 0.75, Scalar(255, 255, 0), 2);
            ostringstream diagnosticsLine;
            diagnosticsLine << "YOLO thr: " << fixed << setprecision(2) << confidenceThreshold
                            << " | P(person) thr: " << verifierPersonThreshold
                            << " | Rejected: " << verifierRejectedThisFrame
                            << " | Kept: " << (personCount + vehicleCount);
            putText(result, diagnosticsLine.str(), Point(20, 95),
                    FONT_HERSHEY_SIMPLEX, 0.65, Scalar(255, 255, 255), 2);
            // Keep a low-volume console telemetry line for easier benchmarking.
            if (frameWorkEndTime - lastPerformanceLogTime >= chrono::seconds(5)) {
                cout << "[PERF] FPS=" << fixed << setprecision(1) << smoothedFps
                     << " | yolo_ms=" << smoothedInferenceMs
                     << " | verifier_ms=" << smoothedVerifierMs
                     << " | detections=" << (personCount + vehicleCount)
                     << " | people=" << personCount
                     << " | vehicles=" << vehicleCount
                     << " | verifier_rejected=" << verifierRejectedThisFrame
                     << " | yolo_threshold=" << setprecision(2) << confidenceThreshold
                     << " | person_threshold=" << verifierPersonThreshold
                     << endl;
                lastPerformanceLogTime = frameWorkEndTime;
            }
            int activeRuntimeTrackId = -1;
            if (!intrudingTrackConfidences.empty()) {
                activeRuntimeTrackId = intrudingTrackConfidences.begin()->first;
            }
            publishRuntimeSnapshot(frame, runtimeDetections, smoothedFps, smoothedInferenceMs,
                                   smoothedVerifierMs, true, audibleAlarm.isActive(),
                                   alarmSilencedByOperator, activeRuntimeTrackId, gZoneEditor);

            Mat displayFrame;
            resize(result, displayFrame, Size(1280, 800));
            imshow("IBVAP - AI Intrusion Detection", displayFrame);
            const int key = waitKey(1) & 0xFF;
            if (key == 27) {
                break;
            }
            if (key == 'm' || key == 'M') {
                if (audibleAlarm.isActive()) {
                    audibleAlarm.silence();
                    alarmSilencedByOperator = true;
                    cout << "[ALARM] Silenced manually. A newly registered intrusion will sound the alarm again." << endl;
                } else {
                    cout << "[ALARM] No active sound to silence." << endl;
                }
            }
            if (key == 't' || key == 'T') {
                if (!gZoneEditor.editing) {
                    gZoneEditor.editing = true;
                    gZoneEditor.originalX1 = gZoneEditor.x1; gZoneEditor.originalY1 = gZoneEditor.y1;
                    gZoneEditor.originalX2 = gZoneEditor.x2; gZoneEditor.originalY2 = gZoneEditor.y2;
                    gZoneEditor.dragging = false;
                    gZoneEditor.hasDraft = false;
                    cout << "[ZONE] Edit mode enabled. Drag left mouse, then press S to save/apply. Press T to cancel." << endl;
                } else {
                    gZoneEditor.x1 = gZoneEditor.originalX1; gZoneEditor.y1 = gZoneEditor.originalY1;
                    gZoneEditor.x2 = gZoneEditor.originalX2; gZoneEditor.y2 = gZoneEditor.originalY2;
                    gZoneEditor.editing = false;
                    gZoneEditor.dragging = false;
                    gZoneEditor.hasDraft = false;
                    cout << "[ZONE] Edit cancelled; previous zone restored." << endl;
                }
            }
            if (key == 's' || key == 'S') {
                if (gZoneEditor.editing) {
                    if (!gZoneEditor.hasDraft) {
                        cout << "[ZONE] Draw a new rectangle first, then press S to save/apply." << endl;
                    } else if (gZoneEditor.x2 - gZoneEditor.x1 < 0.02 ||
                               gZoneEditor.y2 - gZoneEditor.y1 < 0.02) {
                        cout << "[ZONE] Selection is too small. Drag a larger rectangle before saving." << endl;
                    } else if (saveRestrictedZone(zoneConfigPath, gZoneEditor)) {
                        gZoneEditor.editing = false;
                        gZoneEditor.dragging = false;
                        gZoneEditor.hasDraft = false;
                        cout << "[ZONE] Saved and applied restricted zone to " << zoneConfigPath << endl;
                    } else {
                        cerr << "[ZONE] Could not save zone config. Check folder permissions." << endl;
                    }
                }
            }
        }
        video.release();
        eventLog.close();
        trackedEventLog.close();
        sessionEventLog.close();
        destroyAllWindows();
        cout << "IBVAP real-time webcam intrusion monitoring stopped; audible alarm stopped." << endl;
    } catch (const cv::Exception& e) {
        cerr << "OpenCV error:\n" << e.what() << endl;
        return 1;
    } catch (const std::exception& e) {
        cerr << "Error: " << e.what() << endl;
        return 1;
    }
    return 0;
}
