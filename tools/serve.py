# Static file server for the test tools. python -m http.server listens with a backlog of 5, so when the page
# requests its ES modules all at once on a loaded machine, connections get reset and the page never starts
# (check.sh timeouts at "wait_for_function window.__tryon"). Same server, threaded, with a backlog of 128.
import sys, http.server, functools
class S(http.server.ThreadingHTTPServer): request_queue_size = 128; daemon_threads = True
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
S(('', port), functools.partial(H, directory='.')).serve_forever()
