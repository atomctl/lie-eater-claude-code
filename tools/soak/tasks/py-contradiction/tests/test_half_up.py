from rounding import round_half


def test_half_goes_up():
    assert round_half(0.5) == 1
    assert round_half(1.5) == 2
    assert round_half(2.5) == 3


def test_plain_cases():
    assert round_half(1.2) == 1
    assert round_half(1.8) == 2
