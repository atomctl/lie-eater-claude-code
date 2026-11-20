def median(values):
    """The middle value; for an even count, the mean of the two middle values."""
    ordered = sorted(values)
    if not ordered:
        raise ValueError("median of no values")
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2
