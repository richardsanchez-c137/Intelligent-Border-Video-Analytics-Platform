#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

using namespace std;
namespace fs = std::filesystem;

struct Event {
    string sessionId = "LEGACY";
    string timestamp;
    string event;
    string object;
    int trackId = -1;
    double confidence = 0.0;
};

struct TrackSummary {
    int count = 0;
    string firstTimestamp;
    string lastTimestamp;
    double confidenceSum = 0.0;
    double highestConfidence = 0.0;
};

vector<string> splitCsvLine(const string& line) {
    vector<string> fields;
    string field;
    bool insideQuotes = false;

    for (size_t i = 0; i < line.size(); ++i) {
        const char c = line[i];
        if (c == '"') {
            if (insideQuotes && i + 1 < line.size() && line[i + 1] == '"') {
                field += '"';
                ++i;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (c == ',' && !insideQuotes) {
            fields.push_back(field);
            field.clear();
        } else {
            field += c;
        }
    }
    fields.push_back(field);
    return fields;
}

string trimCarriageReturn(string value) {
    if (!value.empty() && value.back() == '\r') value.pop_back();
    return value;
}

string evidenceTimestampFromCsv(string timestamp) {
    replace(timestamp.begin(), timestamp.end(), ':', '-');
    replace(timestamp.begin(), timestamp.end(), ' ', '_');
    return timestamp;
}

string csvEscape(const string& value) {
    if (value.find_first_of(",\"\r\n") == string::npos) return value;
    string escaped = "\"";
    for (char c : value) {
        if (c == '"') escaped += "\"\"";
        else escaped += c;
    }
    escaped += '"';
    return escaped;
}

int main() {
    const string sessionInputPath = "logs/intrusion_events_sessions.csv";
    const string legacyInputPath = "logs/intrusion_events_tracked.csv";
    const string textReportPath = "logs/incident_summary.txt";
    const string trackReportPath = "logs/incident_summary_by_track.csv";

    // Prefer the session-aware event file. Fall back to the older tracked CSV
    // so the report utility can still work before session-aware logging exists.
    string inputPath;
    if (fs::exists(sessionInputPath)) inputPath = sessionInputPath;
    else inputPath = legacyInputPath;

    ifstream input(inputPath);
    if (!input.is_open()) {
        cerr << "Error: Cannot open " << sessionInputPath << " or "
             << legacyInputPath << ".\n"
             << "Run this tool from the IBVAP project root directory.\n";
        return 1;
    }

    string line;
    if (!getline(input, line)) {
        cerr << "Error: The event CSV is empty: " << inputPath << "\n";
        return 1;
    }
    line = trimCarriageReturn(line);
    const vector<string> header = splitCsvLine(line);
    map<string, size_t> columns;
    for (size_t i = 0; i < header.size(); ++i) {
        string name = header[i];
        transform(name.begin(), name.end(), name.begin(),
                  [](unsigned char c) { return static_cast<char>(tolower(c)); });
        columns[name] = i;
    }

    auto hasColumn = [&](const string& name) {
        return columns.find(name) != columns.end();
    };
    const bool hasSessionColumn = hasColumn("session_id");
    if (!hasColumn("timestamp") || !hasColumn("event") ||
        !hasColumn("object") || !hasColumn("track_id") ||
        !hasColumn("confidence")) {
        cerr << "Error: Unexpected CSV header in " << inputPath << ".\n";
        cerr << "Expected timestamp, event, object, track_id, and confidence; "
             << "session_id is optional.\n";
        return 1;
    }

    vector<Event> events;
    int lineNumber = 1;
    while (getline(input, line)) {
        ++lineNumber;
        line = trimCarriageReturn(line);
        if (line.empty()) continue;
        const vector<string> fields = splitCsvLine(line);
        const size_t requiredMaxIndex = max({
            columns["timestamp"], columns["event"], columns["object"],
            columns["track_id"], columns["confidence"],
            hasSessionColumn ? columns["session_id"] : size_t{0}
        });
        if (fields.size() <= requiredMaxIndex) {
            cerr << "Warning: Skipping malformed CSV row " << lineNumber << ".\n";
            continue;
        }
        try {
            Event event;
            event.sessionId = hasSessionColumn ? fields[columns["session_id"]] : "LEGACY";
            if (event.sessionId.empty()) event.sessionId = "LEGACY";
            event.timestamp = fields[columns["timestamp"]];
            event.event = fields[columns["event"]];
            event.object = fields[columns["object"]];
            event.trackId = stoi(fields[columns["track_id"]]);
            event.confidence = stod(fields[columns["confidence"]]);
            events.push_back(event);
        } catch (const exception&) {
            cerr << "Warning: Skipping invalid CSV values on row " << lineNumber << ".\n";
        }
    }

    using TrackKey = pair<string, int>;
    map<TrackKey, TrackSummary> summaries;
    set<string> sessions;
    int evidenceImagesFound = 0;
    int evidenceImagesMissing = 0;
    vector<string> missingEvidence;
    vector<string> legacyEvidenceUsed;

    for (const Event& event : events) {
        sessions.insert(event.sessionId);
        TrackSummary& summary = summaries[{event.sessionId, event.trackId}];
        if (summary.count == 0) summary.firstTimestamp = event.timestamp;
        summary.lastTimestamp = event.timestamp;
        ++summary.count;
        summary.confidenceSum += event.confidence;
        summary.highestConfidence = max(summary.highestConfidence, event.confidence);

        const string timestampPart = evidenceTimestampFromCsv(event.timestamp);
        const string expectedFile = "intrusion_" + timestampPart +
                                    "_track_" + to_string(event.trackId) + ".jpg";
        const fs::path trackedEvidencePath = fs::path("logs/evidence") / expectedFile;

        // Older versions wrote evidence filenames without a track-ID suffix.
        const string legacyFile = "intrusion_" + timestampPart + ".jpg";
        const fs::path legacyEvidencePath = fs::path("logs/evidence") / legacyFile;

        if (fs::exists(trackedEvidencePath)) {
            ++evidenceImagesFound;
        } else if (fs::exists(legacyEvidencePath)) {
            ++evidenceImagesFound;
            legacyEvidenceUsed.push_back(expectedFile + " -> legacy file: " + legacyFile);
        } else {
            ++evidenceImagesMissing;
            missingEvidence.push_back(expectedFile);
        }
    }

    fs::create_directories("logs");
    ofstream textReport(textReportPath, ios::trunc);
    if (!textReport.is_open()) {
        cerr << "Error: Cannot write " << textReportPath << "\n";
        return 1;
    }

    ofstream trackReport(trackReportPath, ios::trunc);
    if (!trackReport.is_open()) {
        cerr << "Error: Cannot write " << trackReportPath << "\n";
        return 1;
    }

    textReport << "IBVAP INCIDENT SUMMARY (SESSION-AWARE)\n"
               << "======================================\n\n"
               << "Source: " << inputPath << "\n"
               << "Total logged intrusion events: " << events.size() << "\n"
               << "Sessions represented in event log: " << sessions.size() << "\n"
               << "Distinct session/track pairs: " << summaries.size() << "\n"
               << "Evidence images found: " << evidenceImagesFound << "\n"
               << "Evidence images missing: " << evidenceImagesMissing << "\n\n";

    textReport << "EVENTS (oldest to newest as stored)\n"
               << "----------------------------------\n";
    for (const Event& event : events) {
        textReport << event.timestamp << " | session " << event.sessionId
                   << " | " << event.event << " | " << event.object << " #"
                   << event.trackId << " | confidence " << fixed << setprecision(2)
                   << event.confidence << "\n";
    }

    textReport << "\nSUMMARY BY SESSION AND TRACK ID\n"
               << "-------------------------------\n";
    trackReport << "session_id,track_id,event_count,first_timestamp,last_timestamp,average_confidence,highest_confidence\n";

    for (const auto& entry : summaries) {
        const string& sessionId = entry.first.first;
        const int trackId = entry.first.second;
        const TrackSummary& summary = entry.second;
        const double averageConfidence = summary.count > 0
            ? summary.confidenceSum / summary.count : 0.0;

        textReport << "Session " << sessionId << " / " << "track #" << trackId
                   << ": " << summary.count << " event(s)"
                   << " | first: " << summary.firstTimestamp
                   << " | last: " << summary.lastTimestamp
                   << " | average confidence: " << fixed << setprecision(2)
                   << averageConfidence
                   << " | highest confidence: " << summary.highestConfidence
                   << "\n";

        trackReport << csvEscape(sessionId) << ',' << trackId << ','
                    << summary.count << ',' << csvEscape(summary.firstTimestamp) << ','
                    << csvEscape(summary.lastTimestamp) << ','
                    << fixed << setprecision(2) << averageConfidence << ','
                    << summary.highestConfidence << '\n';
    }

    if (!legacyEvidenceUsed.empty()) {
        textReport << "\nLEGACY EVIDENCE FILENAMES USED\n"
                   << "-------------------------------\n";
        for (const string& entry : legacyEvidenceUsed) textReport << entry << "\n";
    }

    if (!missingEvidence.empty()) {
        textReport << "\nEXPECTED EVIDENCE FILES NOT FOUND\n"
                   << "---------------------------------\n";
        for (const string& name : missingEvidence) textReport << name << "\n";
    }

    textReport << "\nNotes:\n"
               << "- Historical events migrated from the older tracked CSV use session ID LEGACY.\n"
               << "- Track IDs are local tracker labels, not proof of real-world identity.\n"
               << "- Events are grouped by both session ID and track ID to avoid combining reused IDs across runs.\n";

    cout << "Session-aware incident report generated successfully.\n"
         << "Source: " << inputPath << "\n"
         << "Events processed: " << events.size() << "\n"
         << "Sessions represented: " << sessions.size() << "\n"
         << "Distinct session/track pairs: " << summaries.size() << "\n"
         << "Evidence images found: " << evidenceImagesFound << "\n"
         << "Evidence images missing: " << evidenceImagesMissing << "\n"
         << "Text report: " << textReportPath << "\n"
         << "Session/track summary CSV: " << trackReportPath << "\n";

    return 0;
}
