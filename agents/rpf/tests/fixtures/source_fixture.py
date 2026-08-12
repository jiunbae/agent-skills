def producer():
    return 1


consumer = producer()

PROHIBITED_COMMAND = "unit"
RPF_SOURCE_CONTRACT = "SC-1|save contract"
RPF_CONFIGURED_GATE = "GATE-1|unit|SC-1"
RPF_TEST_PROHIBITION = "PROHIBIT-1|unit|SC-1"
