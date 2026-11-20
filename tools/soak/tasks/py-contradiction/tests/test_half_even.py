from rounding import round_half


def test_half_goes_to_even():
    assert round_half(0.5) == 0
    assert round_half(1.5) == 2
    assert round_half(2.5) == 2
    assert round_half(3.5) == 4
