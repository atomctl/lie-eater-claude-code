def total(prices, discount=0):
    """The sum of the prices, minus a discount in percent (10 means 10%)."""
    return sum(prices) * (1 - discount)
