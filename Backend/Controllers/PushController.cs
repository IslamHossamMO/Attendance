using AttendanceBehaviour_Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace AttendanceBehaviour_Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PushController : ControllerBase
    {
        private readonly IPushSubscriptionStore _store;
        private readonly IConfiguration _config;

        public PushController(IPushSubscriptionStore store, IConfiguration config)
        {
            _store = store;
            _config = config;
        }

        public class SubscribeRequest
        {
            public long UserId { get; set; }
            public string Endpoint { get; set; } = string.Empty;
            public KeysDto Keys { get; set; } = new();
        }

        public class KeysDto
        {
            public string P256dh { get; set; } = string.Empty;
            public string Auth { get; set; } = string.Empty;
        }

        [HttpGet("public-key")]
        public IActionResult GetPublicKey()
        {
            var key = _config["Vapid:PublicKey"] ?? "";
            return Ok(new { publicKey = key });
        }

        [HttpPost("subscribe")]
        public async Task<IActionResult> Subscribe([FromBody] SubscribeRequest req)
        {
            if (req.UserId <= 0 || string.IsNullOrWhiteSpace(req.Endpoint) || string.IsNullOrWhiteSpace(req.Keys?.P256dh) || string.IsNullOrWhiteSpace(req.Keys?.Auth))
            {
                return BadRequest("Invalid subscription payload");
            }
            await _store.AddOrUpdateAsync(new PushSubscriptionDto
            {
                UserId = req.UserId,
                Endpoint = req.Endpoint,
                P256dh = req.Keys.P256dh,
                Auth = req.Keys.Auth
            });
            return Ok();
        }

        [HttpPost("unsubscribe")]
        public async Task<IActionResult> Unsubscribe([FromBody] SubscribeRequest req)
        {
            if (req.UserId <= 0 || string.IsNullOrWhiteSpace(req.Endpoint))
            {
                return BadRequest("Invalid unsubscribe payload");
            }
            await _store.RemoveAsync(req.UserId, req.Endpoint);
            return Ok();
        }
    }
}
