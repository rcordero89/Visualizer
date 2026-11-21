def summarize_grades(students):
    report = {}
    for s in students:
        scores = s["scores"]
        avg = sum(scores) / len(scores)
        report[s["name"]] = {
            "average": round(avg, 1),
            "highest": max(scores),
            "passed": avg >= 70,
        }
    return report


classroom = [
    {"name": "Alice", "scores": [92, 88, 95]},
    {"name": "Bob", "scores": [64, 71, 68]},
    {"name": "Charlie", "scores": [85, 90, 82]},
]

summary = summarize_grades(classroom)
print("Done:", summary["Bob"]["average"])
x = int()